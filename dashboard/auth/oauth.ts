import { HttpError } from '../lib/errors';
import type { SessionGuild } from '../lib/access';
import type { SessionUser } from '../lib/types';

const DISCORD_API = 'https://discord.com/api/v10';
export const OAUTH_SCOPES = ['identify', 'guilds'];

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
}

export function buildAuthorizeUrl(cfg: OAuthConfig, state: string): string {
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: 'code',
    redirect_uri: cfg.redirectUri,
    scope: OAUTH_SCOPES.join(' '),
    state,
    prompt: 'none',
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

/** URL d'invitation du bot sur un serveur donné. */
export function buildBotInviteUrl(clientId: string, guildId?: string): string {
  const params = new URLSearchParams({ client_id: clientId, permissions: '8', scope: 'bot applications.commands' });
  if (guildId) {
    params.set('guild_id', guildId);
    params.set('disable_guild_select', 'true');
  }
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

async function discordFetch<T>(url: string, init: RequestInit, what: string): Promise<T> {
  let res: globalThis.Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new HttpError(502, `Discord est injoignable (${what}).`);
  }
  if (res.status === 401) throw new HttpError(401, 'Session Discord expirée, reconnectez-vous.');
  if (res.status === 429) throw new HttpError(429, 'Discord limite les requêtes, réessayez dans quelques secondes.');
  if (!res.ok) throw new HttpError(502, `Discord a répondu ${res.status} (${what}).`);
  return (await res.json()) as T;
}

export async function exchangeCode(cfg: OAuthConfig, code: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: cfg.redirectUri,
  });
  return discordFetch<TokenResponse>(`${DISCORD_API}/oauth2/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body }, 'échange du code');
}

interface RawUser {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
}

interface RawGuild {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  permissions: string;
}

export async function fetchUser(accessToken: string): Promise<SessionUser> {
  const raw = await discordFetch<RawUser>(`${DISCORD_API}/users/@me`, { headers: { Authorization: `Bearer ${accessToken}` } }, 'profil');
  return { id: raw.id, username: raw.username, globalName: raw.global_name ?? null, avatar: raw.avatar ?? null };
}

export async function fetchGuilds(accessToken: string): Promise<SessionGuild[]> {
  const raw = await discordFetch<RawGuild[]>(`${DISCORD_API}/users/@me/guilds`, { headers: { Authorization: `Bearer ${accessToken}` } }, 'serveurs');
  return raw.map((g) => ({ id: g.id, name: g.name, icon: g.icon ?? null, owner: Boolean(g.owner), permissions: String(g.permissions ?? '0') }));
}

export async function revokeToken(cfg: OAuthConfig, accessToken: string): Promise<void> {
  const body = new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, token: accessToken, token_type_hint: 'access_token' });
  await fetch(`${DISCORD_API}/oauth2/token/revoke`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(5000) }).catch(() => null);
}

/** Durée après laquelle la liste des serveurs est rafraîchie via le token. */
export const GUILDS_TTL_MS = 10 * 60_000;
