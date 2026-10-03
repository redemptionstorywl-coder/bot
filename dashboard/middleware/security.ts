import type { RequestHandler } from 'express';

/**
 * En-têtes de sécurité. CSP stricte : uniquement l'origine du dashboard
 * (le client Socket.IO est servi par le serveur lui-même sur /socket.io/socket.io.js).
 * Les images proviennent du CDN Discord (avatars, icônes).
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: https://cdn.discordapp.com https://media.discordapp.net",
  "font-src 'self'",
  "connect-src 'self' ws: wss:",
  "frame-ancestors 'none'",
  "form-action 'self' https://discord.com",
  "base-uri 'self'",
  "object-src 'none'",
].join('; ');

export function securityHeaders(): RequestHandler {
  return (_req, res, next) => {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    next();
  };
}
