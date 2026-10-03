import type { Guild, GuildMember, PartialGuildMember, User } from 'discord.js';

export interface TemplateContext {
  user?: User | null;
  member?: GuildMember | PartialGuildMember | null;
  guild?: Guild | null;
  language?: string;
  extra?: Record<string, string | number | undefined | null>;
}

/**
 * Remplace les variables `{user}`, `{server}`, `{memberCount}`… dans un texte.
 * Les variables inconnues sont laissées telles quelles.
 */
export function renderTemplate(template: string, ctx: TemplateContext): string {
  if (!template) return '';
  const user = ctx.user ?? ctx.member?.user ?? null;
  const guild = ctx.guild ?? ctx.member?.guild ?? null;
  const now = new Date();
  const vars: Record<string, string> = {
    user: user ? `<@${user.id}>` : '',
    username: user?.username ?? '',
    displayName: ctx.member?.displayName ?? user?.displayName ?? user?.username ?? '',
    tag: user ? (user.discriminator && user.discriminator !== '0' ? `${user.username}#${user.discriminator}` : `@${user.username}`) : '',
    server: guild?.name ?? '',
    memberCount: guild ? String(guild.memberCount) : '',
    userId: user?.id ?? '',
    createdAt: user ? `<t:${Math.floor(user.createdTimestamp / 1000)}:D>` : '',
    joinedAt: ctx.member?.joinedTimestamp ? `<t:${Math.floor(ctx.member.joinedTimestamp / 1000)}:D>` : '',
    language: ctx.language ?? '',
    avatar: user?.displayAvatarURL({ extension: 'png', size: 512 }) ?? '',
    date: now.toLocaleDateString('fr-FR'),
    time: now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
  };
  for (const [k, v] of Object.entries(ctx.extra ?? {})) vars[k] = v == null ? '' : String(v);
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? vars[key]! : match));
}

/** Applique renderTemplate récursivement sur toutes les chaînes d'un objet (EmbedSpec…). */
export function renderObject<T>(value: T, ctx: TemplateContext): T {
  if (typeof value === 'string') return renderTemplate(value, ctx) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => renderObject(v, ctx)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = renderObject(v, ctx);
    return out as T;
  }
  return value;
}
