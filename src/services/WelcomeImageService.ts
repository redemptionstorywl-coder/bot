import sharp from 'sharp';
import { BRAND } from '../config/constants';
import { childLogger } from '../utils/logger';

const log = childLogger('WelcomeImageService');

export const WELCOME_IMAGE_WIDTH = 1024;
export const WELCOME_IMAGE_HEIGHT = 450;
const AVATAR_SIZE = 180;
const FETCH_TIMEOUT_MS = 5_000;
const MAX_REMOTE_BYTES = 8 * 1024 * 1024;

export interface WelcomeImageOptions {
  title: string;
  subtitle?: string;
  avatarUrl?: string | null;
  backgroundUrl?: string | null;
  /** Couleur d'accent (0xRRGGBB). Violet par défaut. */
  accentColor?: number;
  width?: number;
  height?: number;
}

/** Échappe les caractères spéciaux XML pour insertion dans un SVG. */
export function escapeXml(input: string): string {
  return String(input ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/** Tronque un texte pour tenir dans la carte (approximation par largeur de caractère). */
export function fitText(text: string, maxChars: number): string {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

/** Télécharge une ressource binaire avec timeout. Retourne null en cas d'échec. */
export async function fetchBuffer(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<Buffer | null> {
  if (!/^https?:\/\//i.test(url)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    if (!res.ok) return null;
    const length = Number(res.headers.get('content-length') ?? 0);
    if (length > MAX_REMOTE_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_REMOTE_BYTES) return null;
    return buf;
  } catch (err) {
    log.debug({ err, url }, 'fetchBuffer échoué');
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Génère les cartes de bienvenue / départ : fond sombre (#111113), accent violet,
 * fond personnalisé optionnel (assombri), avatar rond au centre, titre + sous-titre.
 */
export class WelcomeImageService {
  /** SVG de la couche graphique (dégradés, accent, textes, anneau d'avatar). */
  buildOverlaySvg(opts: { title: string; subtitle?: string; accent: string; width: number; height: number; avatarSize: number }): string {
    const { width, height, accent, avatarSize } = opts;
    const cx = width / 2;
    const avatarTop = Math.round(height * 0.11);
    const ringRadius = avatarSize / 2 + 8;
    const ringCy = avatarTop + avatarSize / 2;
    const titleY = avatarTop + avatarSize + 74;
    const subtitleY = titleY + 46;
    const title = escapeXml(fitText(opts.title, 28).toUpperCase());
    const subtitle = escapeXml(fitText(opts.subtitle ?? '', 60));
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#111113" stop-opacity="0.35"/>
      <stop offset="0.55" stop-color="#111113" stop-opacity="0.65"/>
      <stop offset="1" stop-color="#111113" stop-opacity="0.95"/>
    </linearGradient>
    <radialGradient id="glow" cx="${cx}" cy="${ringCy}" r="${avatarSize}" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${accent}" stop-opacity="0.45"/>
      <stop offset="1" stop-color="${accent}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#shade)"/>
  <rect width="${width}" height="${height}" fill="url(#glow)"/>
  <rect x="0" y="0" width="${width}" height="6" fill="${accent}"/>
  <rect x="0" y="${height - 6}" width="${width}" height="6" fill="${accent}" fill-opacity="0.6"/>
  <circle cx="${cx}" cy="${ringCy}" r="${ringRadius}" fill="none" stroke="${accent}" stroke-width="6"/>
  <text x="${cx}" y="${titleY}" text-anchor="middle" font-family="Inter, 'Segoe UI', Roboto, Arial, sans-serif" font-size="46" font-weight="800" letter-spacing="4" fill="#F5F5F7">${title}</text>
  <text x="${cx}" y="${subtitleY}" text-anchor="middle" font-family="Inter, 'Segoe UI', Roboto, Arial, sans-serif" font-size="24" font-weight="500" fill="#C9C9D1">${subtitle}</text>
  <rect x="${cx - 60}" y="${subtitleY + 26}" width="120" height="3" rx="1.5" fill="${accent}"/>
</svg>`;
  }

  private circleMask(size: number): Buffer {
    return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`);
  }

  /** Avatar rond (PNG RGBA) ou null si indisponible. */
  private async buildAvatar(url: string | null | undefined, size: number): Promise<Buffer | null> {
    if (!url) return null;
    const raw = await fetchBuffer(url);
    if (!raw) return null;
    try {
      return await sharp(raw)
        .resize(size, size, { fit: 'cover' })
        .composite([{ input: this.circleMask(size), blend: 'dest-in' }])
        .png()
        .toBuffer();
    } catch (err) {
      log.debug({ err }, 'Avatar illisible');
      return null;
    }
  }

  /** Fond : image distante redimensionnée et assombrie, sinon aplat sombre. */
  private async buildBackground(url: string | null | undefined, width: number, height: number): Promise<sharp.Sharp> {
    if (url) {
      const raw = await fetchBuffer(url);
      if (raw) {
        try {
          const bg = await sharp(raw).resize(width, height, { fit: 'cover' }).modulate({ brightness: 0.45, saturation: 0.85 }).blur(1.2).png().toBuffer();
          return sharp(bg);
        } catch (err) {
          log.debug({ err }, 'Fond illisible, aplat utilisé');
        }
      }
    }
    return sharp({ create: { width, height, channels: 4, background: hex(BRAND.colors.dark) } });
  }

  /**
   * Génère la carte et retourne un Buffer PNG.
   * Lance une erreur en cas d'échec de sharp : l'appelant doit l'attraper (fallback sans image).
   */
  async generate(opts: WelcomeImageOptions): Promise<Buffer> {
    const width = opts.width ?? WELCOME_IMAGE_WIDTH;
    const height = opts.height ?? WELCOME_IMAGE_HEIGHT;
    const accent = hex(opts.accentColor ?? BRAND.colors.primary);
    const [background, avatar] = await Promise.all([this.buildBackground(opts.backgroundUrl, width, height), this.buildAvatar(opts.avatarUrl, AVATAR_SIZE)]);
    const overlay = Buffer.from(this.buildOverlaySvg({ title: opts.title, subtitle: opts.subtitle, accent, width, height, avatarSize: AVATAR_SIZE }));
    const layers: sharp.OverlayOptions[] = [{ input: overlay, top: 0, left: 0 }];
    if (avatar) layers.push({ input: avatar, top: Math.round(height * 0.11), left: Math.round(width / 2 - AVATAR_SIZE / 2) });
    return background.composite(layers).png({ compressionLevel: 8 }).toBuffer();
  }

  /** Comme generate() mais ne lance jamais : retourne null et logge un warn. */
  async tryGenerate(opts: WelcomeImageOptions): Promise<Buffer | null> {
    try {
      return await this.generate(opts);
    } catch (err) {
      log.warn({ err }, 'Génération de l’image de bienvenue impossible — envoi sans image');
      return null;
    }
  }
}

export const welcomeImageService = new WelcomeImageService();
