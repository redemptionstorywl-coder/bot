import path from 'node:path';
import { PUBLIC_DIR } from './paths';

/**
 * Accès serveur au moteur d'aperçu Discord partagé (public/js/discord-preview.js).
 * Le même fichier est servi au navigateur : le balisage des aperçus est donc identique côté serveur et client.
 */

export interface PreviewButton {
  label?: string;
  style?: string;
  emoji?: string;
  url?: string;
  disabled?: boolean;
  highlight?: boolean;
}

export interface PreviewSelect {
  type: 'select';
  placeholder?: string;
  open?: boolean;
  disabled?: boolean;
  options: { label: string; description?: string | null; emoji?: string | null }[];
}

export interface PreviewButtonRow {
  type: 'buttons';
  buttons: PreviewButton[];
}

export interface PreviewMessage {
  content?: string | null;
  embed?: unknown;
  embeds?: unknown[];
  buttons?: PreviewButton[];
  attachments?: { url?: string; name?: string; mock?: { title: string; subtitle?: string } }[];
  components?: (PreviewSelect | PreviewButtonRow)[];
  author?: { name: string; avatarUrl?: string | null; bot?: boolean };
  ephemeral?: boolean;
  compact?: boolean;
  emptyText?: string;
}

export interface PreviewContext {
  roles: Record<string, { name: string; color: string }>;
  channels: Record<string, string>;
  users: Record<string, string>;
  botName: string;
  botAvatarUrl: string | null;
  defaultColor: string;
  now?: string | number | Date;
}

export interface PreviewModal {
  title: string;
  fields: { label: string; placeholder?: string; style?: 'short' | 'paragraph'; required?: boolean; maxLength?: number }[];
}

export interface DiscordPreviewApi {
  escape(value: unknown): string;
  markdown(text: string, ctx: Partial<PreviewContext>, opts?: { inline?: boolean }): string;
  render(message: PreviewMessage, ctx: Partial<PreviewContext>): string;
  renderModal(modal: PreviewModal, ctx?: Partial<PreviewContext>): string;
  contextFromGuild(guild: unknown, bot: { username?: string; name?: string; avatarUrl?: string | null } | null, extra?: Partial<PreviewContext>): PreviewContext;
  applyVars(text: string, vars: Record<string, string | number>): string;
  applyVarsDeep<T>(value: T, vars: Record<string, string | number>): T;
  layoutFields(fields: unknown[], hasThumb: boolean): { field: unknown; span: number }[];
  isImageAllowed(url: unknown): boolean;
  hasEmbedContent(embed: unknown): boolean;
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
export const discordPreview = require(path.join(PUBLIC_DIR, 'js', 'discord-preview.js')) as DiscordPreviewApi;
