import 'express-session';
import type { SessionGuild } from './access';
import type { ResolvedGuildConfig } from '../../src/services/GuildConfigService';
import type { GuildView } from './guildData';

export interface SessionUser {
  id: string;
  username: string;
  globalName: string | null;
  avatar: string | null;
}

export type FlashType = 'success' | 'error' | 'info' | 'warning';
export interface FlashMessage {
  type: FlashType;
  message: string;
}

declare module 'express-session' {
  interface SessionData {
    user?: SessionUser;
    guilds?: SessionGuild[];
    /** Jeton OAuth2 Discord — jamais renvoyé au navigateur */
    accessToken?: string;
    /** Date (ms) de la dernière récupération de /users/@me/guilds */
    fetchedAt?: number;
    oauthState?: string;
    csrfToken?: string;
    flash?: FlashMessage[];
    returnTo?: string;
  }
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Locals {
      /** Serveur Discord courant (après requireGuildAccess) */
      guild?: GuildView;
      /** Configuration résolue du serveur courant */
      config?: ResolvedGuildConfig | null;
      /** Clé de navigation active (voir lib/navigation.ts) */
      page?: string;
      csrfToken?: string;
      [key: string]: unknown;
    }
  }
}

/** Requête de handshake Socket.IO : la session express y est attachée par io.engine.use(sessionMiddleware). */
export type SessionRequest = import('http').IncomingMessage & { session?: import('express-session').Session & Partial<import('express-session').SessionData> };
