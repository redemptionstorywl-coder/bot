import { Router } from 'express';
import { z } from 'zod';
import type { RedemptionClient } from '../../../src/core/Client';
import { embedTemplateService } from '../../../src/services/EmbedTemplateService';
import { render } from '../../lib/render';
import { wrap } from '../../lib/async';
import { flash } from '../../lib/flash';
import { HttpError } from '../../lib/errors';
import { validate, valid, optionalText, discordIdSchema } from '../../lib/validate';
import { embedFormSchema, buttonsJsonSchema, toEmbedSpec, safeEmbedSpec, safeButtons } from '../../lib/embedForm';
import { formAction } from '../../lib/serviceErrors';
import { requireBotGuild } from '../../lib/names';
import { broadcastToGuild } from '../../sockets';

const idParams = z.object({ templateId: z.coerce.number().int().positive() });

const templateBody = z.object({
  name: z.string().trim().min(1, 'nom requis').max(100),
  description: optionalText(200),
  embed: embedFormSchema,
  buttonsJson: buttonsJsonSchema,
});

const importBody = z.object({
  name: z.string().trim().min(1, 'nom requis').max(100),
  json: z.string().min(2, 'JSON requis').max(20_000),
});

const sendBody = z.object({
  channelId: discordIdSchema,
  content: optionalText(2000),
});

/** Pages Embeds : templates (liste + aperçus), éditeur complet, import/export JSON, envoi dans un salon. */
export function createEmbedsRouter(client: RedemptionClient): Router {
  const router = Router({ mergeParams: true });
  const base = (guildId: string) => `/guilds/${guildId}/embeds`;

  async function loadTemplate(guildId: string, id: number) {
    const template = await embedTemplateService.get(id);
    if (!template || template.guildId !== guildId) throw new HttpError(404, 'Template introuvable.');
    return template;
  }

  router.get(
    '/embeds',
    wrap(async (_req, res) => {
      const guild = res.locals.guild!;
      const templates = await embedTemplateService.list(guild.id);
      render(res, 'embeds', {
        title: 'Embeds',
        page: 'embeds',
        templates: templates.map((t) => ({ ...t, spec: safeEmbedSpec(t.spec), buttonList: safeButtons(t.buttons) })),
        moduleEnabled: res.locals.config!.modules.embeds,
      });
    }),
  );

  router.get(
    '/embeds/new',
    wrap(async (_req, res) => {
      render(res, 'embed-form', { title: 'Nouveau template', page: 'embeds', layout: 'wide', crumbs: [{ label: 'Nouveau template' }], template: null, spec: {}, buttons: [] });
    }),
  );

  router.get(
    '/embeds/:templateId(\\d+)',
    validate({ params: idParams }),
    wrap(async (req, res) => {
      const guild = res.locals.guild!;
      const { params } = valid<unknown, unknown, z.infer<typeof idParams>>(req);
      const template = await loadTemplate(guild.id, params.templateId);
      render(res, 'embed-form', {
        title: `Template · ${template.name}`,
        page: 'embeds',
        layout: 'wide',
        crumbs: [{ label: template.name }],
        template,
        spec: safeEmbedSpec(template.spec),
        buttons: safeButtons(template.buttons),
      });
    }),
  );

  router.get(
    '/embeds/:templateId(\\d+)/export',
    validate({ params: idParams }),
    wrap(async (req, res) => {
      const guild = res.locals.guild!;
      const { params } = valid<unknown, unknown, z.infer<typeof idParams>>(req);
      const template = await loadTemplate(guild.id, params.templateId);
      const json = embedTemplateService.exportJson(embedTemplateService.toMessageSpec(template));
      const filename = `${template.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'embed'}.json`;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(json);
    }),
  );

  router.post(
    '/embeds',
    validate({ body: templateBody }),
    formAction(
      (_req, res) => `${base(res.locals.guild!.id)}/new`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { body } = valid<z.infer<typeof templateBody>>(req);
        const spec = toEmbedSpec(body.embed);
        if (!spec) throw new HttpError(400, "L'embed est vide : ajoutez au moins un titre ou une description.");
        const template = await embedTemplateService.create(guild.id, { name: body.name, description: body.description ?? null, spec, buttons: body.buttonsJson }, req.session.user!.id);
        broadcastToGuild(guild.id, 'embed:update', { guildId: guild.id, templateId: template.id });
        flash(req, 'success', `Template « ${template.name} » créé.`);
        return base(guild.id);
      },
    ),
  );

  router.post(
    '/embeds/import',
    validate({ body: importBody }),
    formAction(
      (_req, res) => base(res.locals.guild!.id),
      async (req, res) => {
        const guild = res.locals.guild!;
        const { body } = valid<z.infer<typeof importBody>>(req);
        const parsed = embedTemplateService.parseImport(body.json);
        if (!parsed.success) throw new HttpError(400, 'JSON invalide', parsed.error.split('\n'));
        const spec = parsed.data.embeds?.[0];
        if (!spec || !Object.keys(spec).length) throw new HttpError(400, 'Le JSON ne contient aucun embed.');
        const template = await embedTemplateService.create(guild.id, { name: body.name, spec, buttons: parsed.data.buttons ?? [] }, req.session.user!.id);
        broadcastToGuild(guild.id, 'embed:update', { guildId: guild.id, templateId: template.id });
        flash(req, 'success', `Template « ${template.name} » importé.`);
        return `${base(guild.id)}/${template.id}`;
      },
    ),
  );

  router.post(
    '/embeds/:templateId(\\d+)',
    validate({ params: idParams, body: templateBody }),
    formAction(
      (req, res) => `${base(res.locals.guild!.id)}/${req.params.templateId}`,
      async (req, res) => {
        const guild = res.locals.guild!;
        const { params, body } = valid<z.infer<typeof templateBody>, unknown, z.infer<typeof idParams>>(req);
        await loadTemplate(guild.id, params.templateId);
        const spec = toEmbedSpec(body.embed);
        if (!spec) throw new HttpError(400, "L'embed est vide : ajoutez au moins un titre ou une description.");
        const template = await embedTemplateService.update(params.templateId, { name: body.name, description: body.description ?? null, spec, buttons: body.buttonsJson });
        broadcastToGuild(guild.id, 'embed:update', { guildId: guild.id, templateId: template.id });
        flash(req, 'success', `Template « ${template.name} » enregistré.`);
      },
    ),
  );

  router.post(
    '/embeds/:templateId(\\d+)/delete',
    validate({ params: idParams }),
    formAction(
      (_req, res) => base(res.locals.guild!.id),
      async (req, res) => {
        const guild = res.locals.guild!;
        const { params } = valid<unknown, unknown, z.infer<typeof idParams>>(req);
        const template = await loadTemplate(guild.id, params.templateId);
        await embedTemplateService.delete(template.id);
        broadcastToGuild(guild.id, 'embed:update', { guildId: guild.id, templateId: template.id, deleted: true });
        flash(req, 'success', `Template « ${template.name} » supprimé.`);
      },
    ),
  );

  router.post(
    '/embeds/:templateId(\\d+)/send',
    validate({ params: idParams, body: sendBody }),
    formAction(
      (req, res) => `${base(res.locals.guild!.id)}/${req.params.templateId}`,
      async (req, res) => {
        const guildView = res.locals.guild!;
        const { params, body } = valid<z.infer<typeof sendBody>, unknown, z.infer<typeof idParams>>(req);
        const template = await loadTemplate(guildView.id, params.templateId);
        const guild = requireBotGuild(client, guildView.id);
        if (!guildView.textChannels.some((c) => c.id === body.channelId)) throw new HttpError(400, 'Salon inconnu.');
        const spec = embedTemplateService.toMessageSpec(template);
        const message = await embedTemplateService.sendSpec(guildView.id, body.channelId, { ...spec, content: body.content ?? undefined }, { client, guild, language: res.locals.config!.defaultLanguage });
        flash(req, 'success', `Embed envoyé dans #${guildView.textChannels.find((c) => c.id === body.channelId)?.name ?? body.channelId} (message ${message.id}).`);
        return base(guildView.id);
      },
    ),
  );

  return router;
}
