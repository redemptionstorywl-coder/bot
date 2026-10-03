import session, { type SessionOptions } from 'express-session';
import type { RequestHandler } from 'express';
import type { Env } from '../../src/config/env';
import { PrismaSessionStore } from './PrismaSessionStore';

export const SESSION_COOKIE_NAME = 'rss.sid';
export const SESSION_MAX_AGE_MS = 7 * 24 * 3600_000;

/** Middleware express-session partagé entre Express et Socket.IO. */
export function createSessionMiddleware(env: Env): RequestHandler {
  const isProd = env.NODE_ENV === 'production';
  const options: SessionOptions = {
    name: SESSION_COOKIE_NAME,
    secret: env.SESSION_SECRET,
    store: new PrismaSessionStore(SESSION_MAX_AGE_MS),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    proxy: isProd,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,
      maxAge: SESSION_MAX_AGE_MS,
      path: '/',
    },
  };
  return session(options);
}
