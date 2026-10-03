import pino from 'pino';
import fs from 'node:fs';
import path from 'node:path';

const level = process.env.LOG_LEVEL ?? 'info';
const isProd = process.env.NODE_ENV === 'production';
const logDir = path.resolve(process.cwd(), 'logs');

try {
  fs.mkdirSync(logDir, { recursive: true });
} catch {
  /* ignore */
}

/** Clés à ne jamais écrire dans les logs. */
const REDACT_PATHS = ['token', 'DISCORD_TOKEN', 'DISCORD_CLIENT_SECRET', 'SESSION_SECRET', 'FIVEM_API_KEY', 'apiKey', 'password', 'secret', 'authorization', 'req.headers.authorization', 'req.headers.cookie', '*.token', '*.apiKey', '*.password'];

const targets: pino.TransportTargetOptions[] = [
  {
    target: 'pino/file',
    level,
    options: { destination: path.join(logDir, 'bot.log'), mkdir: true },
  },
  {
    target: 'pino/file',
    level: 'error',
    options: { destination: path.join(logDir, 'error.log'), mkdir: true },
  },
];

if (!isProd && process.env.NODE_ENV !== 'test') {
  targets.push({
    target: 'pino-pretty',
    level,
    options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
  });
} else {
  targets.push({ target: 'pino/file', level, options: { destination: 1 } });
}

export const logger =
  process.env.NODE_ENV === 'test'
    ? pino({ level: 'silent' })
    : pino(
        {
          level,
          redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
          base: { app: 'redemption-story-bot' },
        },
        pino.transport({ targets }),
      );

export type Logger = typeof logger;

export function childLogger(name: string): pino.Logger {
  return logger.child({ module: name });
}
