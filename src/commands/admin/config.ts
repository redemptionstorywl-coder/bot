import path from 'node:path';
import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { defineCommand } from '../../structures';
import type { ConfigPanel } from '../../structures/configPanel';
import { walk } from '../../core/loaders';
import { embedService } from '../../services/EmbedService';
import { childLogger } from '../../utils/logger';

const log = childLogger('Config');

/** Charge tous les panneaux de `src/panels/` (synchrone, au chargement de la commande). */
function loadPanels(): ConfigPanel[] {
  const dir = path.resolve(__dirname, '..', '..', 'panels');
  const panels: ConfigPanel[] = [];
  for (const file of walk(dir)) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(file) as { default?: ConfigPanel };
    if (mod.default?.key && typeof mod.default.open === 'function') panels.push(mod.default);
    else log.warn({ file }, 'Panneau de configuration ignoré (export invalide)');
  }
  return panels.sort((a, b) => a.order - b.order).slice(0, 25);
}

export const CONFIG_PANELS = loadPanels();

/**
 * `/config module:<panneau>` — point d'entrée unique de toute la configuration du bot.
 * Chaque module ouvre un panneau interactif complet (boutons, menus, formulaires).
 */
export default defineCommand({
  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Ouvrir le panneau de configuration d’un module')
    .addStringOption((o) =>
      o
        .setName('module')
        .setDescription('Module à configurer')
        .setRequired(true)
        .addChoices(...CONFIG_PANELS.map((p) => ({ name: `${p.emoji} ${p.label}`, value: p.key }))),
    ),
  permissions: { internal: 'admin' },
  cooldown: 2,
  async execute(interaction, ctx) {
    const key = interaction.options.getString('module', true);
    const panel = CONFIG_PANELS.find((p) => p.key === key);
    if (!panel) {
      await interaction.reply({ embeds: [embedService.error(ctx.t('core.not_found'))], flags: MessageFlags.Ephemeral });
      return;
    }
    await panel.open(interaction, ctx);
  },
});
