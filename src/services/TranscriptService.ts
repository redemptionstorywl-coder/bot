import fs from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { BRAND } from '../config/constants';
import { formatDuration } from '../utils/time';
import { translationService } from './TranslationService';
import { childLogger } from '../utils/logger';

const log = childLogger('TranscriptService');

export interface TranscriptAttachment {
  name: string;
  url: string;
  size?: number;
}

export interface TranscriptEmbed {
  title?: string | null;
  description?: string | null;
}

export interface TranscriptMessage {
  messageId: string;
  authorId: string;
  authorTag: string;
  authorAvatar?: string | null;
  content: string;
  attachments: TranscriptAttachment[];
  embeds: TranscriptEmbed[];
  createdAt: Date;
}

export interface TranscriptParticipant {
  id: string;
  tag: string;
  avatar?: string | null;
  staff?: boolean;
}

export interface TranscriptData {
  guildId: string;
  guildName: string;
  guildIcon?: string | null;
  ticketNumber: number;
  ticketId: number;
  typeLabel: string;
  typeEmoji?: string | null;
  /** Titre saisi à l'ouverture */
  title?: string | null;
  creator: TranscriptParticipant;
  closedBy?: TranscriptParticipant | null;
  closeReason?: string | null;
  openedAt: Date;
  closedAt: Date;
  participants: TranscriptParticipant[];
  /** [{ question, answer }] */
  formAnswers: { question: string; answer: string }[];
  messages: TranscriptMessage[];
  language: string;
}

export interface TranscriptFiles {
  htmlPath: string;
  txtPath: string;
  pdfPath: string;
  messageCount: number;
  durationSeconds: number;
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Échappe une chaîne pour insertion sûre dans du HTML. */
export function escapeHtml(input: string | null | undefined): string {
  if (!input) return '';
  return String(input).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}

/** Supprime les caractères que la police PDF par défaut ne sait pas rendre (emoji, symboles astraux). */
function pdfSafe(input: string): string {
  return input.replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '').replace(/\r/g, '');
}

function fmtDate(date: Date, lang: string): string {
  return date.toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Génère les transcripts d'un ticket (HTML premium sombre, TXT brut, PDF) et les écrit dans
 * `uploads/transcripts/<guildId>/ticket-<number>.{html,txt,pdf}`.
 * Service pur : aucune dépendance Discord, testable unitairement.
 */
export class TranscriptService {
  constructor(private readonly baseDir = path.resolve(process.cwd(), 'uploads', 'transcripts')) {}

  get directory(): string {
    return this.baseDir;
  }

  /** Dossier d'un serveur (créé si absent). */
  guildDir(guildId: string): string {
    const dir = path.join(this.baseDir, guildId.replace(/[^0-9]/g, ''));
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  filePaths(guildId: string, number: number): { htmlPath: string; txtPath: string; pdfPath: string } {
    const dir = this.guildDir(guildId);
    const base = path.join(dir, `ticket-${number}`);
    return { htmlPath: `${base}.html`, txtPath: `${base}.txt`, pdfPath: `${base}.pdf` };
  }

  durationSeconds(data: Pick<TranscriptData, 'openedAt' | 'closedAt'>): number {
    return Math.max(0, Math.floor((data.closedAt.getTime() - data.openedAt.getTime()) / 1000));
  }

  /** Génère les trois formats et retourne les chemins + statistiques. */
  async generate(data: TranscriptData): Promise<TranscriptFiles> {
    const paths = this.filePaths(data.guildId, data.ticketNumber);
    await fs.promises.writeFile(paths.htmlPath, this.renderHtml(data), 'utf8');
    await fs.promises.writeFile(paths.txtPath, this.renderTxt(data), 'utf8');
    try {
      await this.renderPdf(data, paths.pdfPath);
    } catch (err) {
      log.error({ err, ticket: data.ticketId }, 'Génération PDF échouée');
      throw err;
    }
    return { ...paths, messageCount: data.messages.length, durationSeconds: this.durationSeconds(data) };
  }

  // ───────────── TXT ─────────────

  renderTxt(data: TranscriptData): string {
    const t = translationService.bind(data.language);
    const lines: string[] = [];
    const sep = '═'.repeat(60);
    lines.push(sep);
    lines.push(`${BRAND.name} — ${t('tickets.transcript.title', { number: data.ticketNumber })}`);
    lines.push(sep);
    lines.push(`${t('tickets.transcript.ticket')}: #${data.ticketNumber} (${data.guildName})`);
    if (data.title) lines.push(`${t('tickets.transcript.title_field')}: ${data.title}`);
    lines.push(`${t('tickets.transcript.type')}: ${data.typeEmoji ? `${data.typeEmoji} ` : ''}${data.typeLabel}`);
    lines.push(`${t('tickets.transcript.opened_by')}: ${data.creator.tag} (${data.creator.id})`);
    lines.push(`${t('tickets.transcript.closed_by')}: ${data.closedBy ? `${data.closedBy.tag} (${data.closedBy.id})` : t('tickets.transcript.none')}`);
    lines.push(`${t('tickets.transcript.reason')}: ${data.closeReason?.trim() || t('tickets.transcript.none')}`);
    lines.push(`${t('tickets.transcript.opened_at')}: ${fmtDate(data.openedAt, data.language)}`);
    lines.push(`${t('tickets.transcript.closed_at')}: ${fmtDate(data.closedAt, data.language)}`);
    lines.push(`${t('tickets.transcript.duration')}: ${formatDuration(this.durationSeconds(data), data.language)}`);
    lines.push(`${t('tickets.transcript.messages')}: ${data.messages.length}`);
    lines.push(`${t('tickets.transcript.participants')}: ${data.participants.map((p) => `${p.tag}${p.staff ? ' [staff]' : ''}`).join(', ') || t('tickets.transcript.none')}`);
    if (data.formAnswers.length) {
      lines.push('');
      for (const a of data.formAnswers) lines.push(`• ${a.question}: ${a.answer || t('tickets.transcript.none')}`);
    }
    lines.push(sep);
    lines.push('');
    if (!data.messages.length) lines.push(t('tickets.transcript.no_messages'));
    for (const m of data.messages) {
      lines.push(`[${fmtDate(m.createdAt, data.language)}] ${m.authorTag} (${m.authorId}):`);
      if (m.content) lines.push(...m.content.split('\n').map((l) => `    ${l}`));
      for (const e of m.embeds) {
        const parts = [e.title, e.description].filter(Boolean);
        if (parts.length) lines.push(`    [${t('tickets.transcript.embed')}] ${parts.join(' — ')}`);
      }
      if (m.attachments.length) lines.push(`    [${t('tickets.transcript.attachments')}] ${m.attachments.map((a) => `${a.name} <${a.url}>`).join(', ')}`);
      lines.push('');
    }
    lines.push(sep);
    lines.push(t('tickets.transcript.generated', { date: fmtDate(new Date(), data.language) }));
    return lines.join('\n');
  }

  // ───────────── HTML ─────────────

  renderHtml(data: TranscriptData): string {
    const t = translationService.bind(data.language);
    const title = t('tickets.transcript.title', { number: data.ticketNumber });
    const duration = formatDuration(this.durationSeconds(data), data.language);
    const none = t('tickets.transcript.none');
    const person = (p?: TranscriptParticipant | null) => (p ? `${escapeHtml(p.tag)} <span class="id">${escapeHtml(p.id)}</span>` : none);

    const meta = [
      ...(data.title ? [[t('tickets.transcript.title_field'), escapeHtml(data.title)]] : []),
      [t('tickets.transcript.type'), `${escapeHtml(data.typeEmoji ?? '')} ${escapeHtml(data.typeLabel)}`.trim()],
      [t('tickets.transcript.opened_by'), person(data.creator)],
      [t('tickets.transcript.closed_by'), person(data.closedBy)],
      [t('tickets.transcript.reason'), escapeHtml(data.closeReason?.trim()) || none],
      [t('tickets.transcript.opened_at'), escapeHtml(fmtDate(data.openedAt, data.language))],
      [t('tickets.transcript.closed_at'), escapeHtml(fmtDate(data.closedAt, data.language))],
      [t('tickets.transcript.duration'), escapeHtml(duration)],
      [t('tickets.transcript.messages'), String(data.messages.length)],
    ]
      .map(([k, v]) => `<div class="meta-item"><span class="k">${escapeHtml(k)}</span><span class="v">${v}</span></div>`)
      .join('');

    const participants = data.participants
      .map((p) => `<li>${avatar(p.avatar, p.tag)}<span>${escapeHtml(p.tag)}</span>${p.staff ? '<span class="badge">staff</span>' : ''}</li>`)
      .join('');

    const answers = data.formAnswers.length
      ? `<section class="card answers"><h2>${escapeHtml(t('tickets.info.answers'))}</h2>${data.formAnswers
          .map((a) => `<div class="answer"><div class="q">${escapeHtml(a.question)}</div><div class="a">${escapeHtml(a.answer) || none}</div></div>`)
          .join('')}</section>`
      : '';

    const messages = data.messages.length
      ? data.messages
          .map((m) => {
            const staff = data.participants.find((p) => p.id === m.authorId)?.staff;
            const embeds = m.embeds
              .filter((e) => e.title || e.description)
              .map((e) => `<div class="embed">${e.title ? `<div class="embed-title">${escapeHtml(e.title)}</div>` : ''}${e.description ? `<div class="embed-desc">${escapeHtml(e.description)}</div>` : ''}</div>`)
              .join('');
            const attachments = m.attachments.length
              ? `<div class="attachments">${m.attachments.map((a) => `<a href="${escapeHtml(a.url)}" target="_blank" rel="noopener noreferrer">📎 ${escapeHtml(a.name)}</a>`).join('')}</div>`
              : '';
            return `<article class="msg${staff ? ' staff' : ''}">
  ${avatar(m.authorAvatar, m.authorTag)}
  <div class="body">
    <header><span class="author">${escapeHtml(m.authorTag)}</span>${staff ? '<span class="badge">staff</span>' : ''}<time>${escapeHtml(fmtDate(m.createdAt, data.language))}</time></header>
    ${m.content ? `<div class="content">${escapeHtml(m.content)}</div>` : ''}
    ${embeds}${attachments}
  </div>
</article>`;
          })
          .join('\n')
      : `<p class="empty">${escapeHtml(t('tickets.transcript.no_messages'))}</p>`;

    return `<!doctype html>
<html lang="${escapeHtml(data.language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — ${escapeHtml(data.guildName)}</title>
<style>
  :root { --bg: #0b0a10; --panel: #15131d; --panel-2: #1c1927; --border: #2a2638; --text: #ece9f4; --muted: #8f88a6; --violet: #7c3aed; --violet-soft: rgba(124,58,237,.18); --danger: #ef4444; }
  * { box-sizing: border-box; }
  body { margin: 0; background: radial-gradient(1200px 600px at 20% -10%, rgba(124,58,237,.18), transparent 60%), var(--bg); color: var(--text); font: 15px/1.55 "Inter", "Segoe UI", system-ui, -apple-system, sans-serif; }
  .wrap { max-width: 980px; margin: 0 auto; padding: 32px 16px 64px; }
  .hero { display: flex; gap: 18px; align-items: center; padding: 24px; border-radius: 18px; background: linear-gradient(135deg, var(--panel-2), var(--panel)); border: 1px solid var(--border); box-shadow: 0 20px 60px rgba(0,0,0,.45); }
  .hero .icon { width: 64px; height: 64px; border-radius: 16px; background: var(--violet-soft); display: grid; place-items: center; font-size: 28px; overflow: hidden; flex: none; }
  .hero .icon img { width: 100%; height: 100%; object-fit: cover; }
  .hero h1 { margin: 0; font-size: 22px; letter-spacing: .2px; }
  .hero p { margin: 4px 0 0; color: var(--muted); }
  .hero .num { margin-left: auto; font-weight: 700; font-size: 28px; color: var(--violet); }
  .card { margin-top: 18px; padding: 20px 22px; border-radius: 16px; background: var(--panel); border: 1px solid var(--border); }
  .card h2 { margin: 0 0 12px; font-size: 14px; text-transform: uppercase; letter-spacing: .12em; color: var(--muted); }
  .meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px 20px; }
  .meta-item { display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border-radius: 10px; background: var(--panel-2); }
  .meta-item .k { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; }
  .meta-item .v { font-weight: 600; }
  .id { color: var(--muted); font-weight: 400; font-size: 12px; margin-left: 6px; }
  ul.participants { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 10px; }
  ul.participants li { display: flex; align-items: center; gap: 8px; padding: 6px 12px 6px 6px; border-radius: 999px; background: var(--panel-2); border: 1px solid var(--border); }
  .avatar { width: 36px; height: 36px; border-radius: 50%; background: var(--violet-soft); color: var(--violet); display: grid; place-items: center; font-weight: 700; flex: none; overflow: hidden; }
  .avatar img { width: 100%; height: 100%; object-fit: cover; }
  ul.participants .avatar { width: 28px; height: 28px; font-size: 12px; }
  .badge { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; padding: 2px 8px; border-radius: 999px; background: var(--violet); color: #fff; }
  .answers .answer { padding: 10px 0; border-top: 1px solid var(--border); }
  .answers .answer:first-of-type { border-top: 0; }
  .answers .q { color: var(--muted); font-size: 13px; }
  .answers .a { white-space: pre-wrap; }
  .messages { margin-top: 18px; display: flex; flex-direction: column; gap: 6px; }
  .msg { display: flex; gap: 14px; padding: 12px 16px; border-radius: 14px; border: 1px solid transparent; }
  .msg:hover { background: var(--panel); border-color: var(--border); }
  .msg.staff { border-left: 3px solid var(--violet); }
  .msg header { display: flex; align-items: center; gap: 8px; }
  .msg .author { font-weight: 600; }
  .msg time { color: var(--muted); font-size: 12px; margin-left: auto; }
  .msg .body { flex: 1; min-width: 0; }
  .msg .content { white-space: pre-wrap; word-wrap: break-word; margin-top: 2px; }
  .embed { margin-top: 8px; padding: 10px 14px; border-left: 4px solid var(--violet); border-radius: 6px; background: var(--panel-2); }
  .embed-title { font-weight: 600; }
  .embed-desc { white-space: pre-wrap; color: #d8d3ea; margin-top: 2px; }
  .attachments { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
  .attachments a { color: var(--violet); text-decoration: none; padding: 4px 10px; border-radius: 8px; background: var(--violet-soft); font-size: 13px; }
  .empty { color: var(--muted); text-align: center; padding: 40px 0; }
  footer { margin-top: 32px; text-align: center; color: var(--muted); font-size: 12px; }
</style>
</head>
<body>
<div class="wrap">
  <header class="hero">
    <div class="icon">${data.guildIcon ? `<img src="${escapeHtml(data.guildIcon)}" alt="">` : '🎫'}</div>
    <div>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(data.guildName)} • ${escapeHtml(BRAND.name)}</p>
    </div>
    <div class="num">#${data.ticketNumber}</div>
  </header>
  <section class="card"><div class="meta">${meta}</div></section>
  <section class="card"><h2>${escapeHtml(t('tickets.transcript.participants'))}</h2><ul class="participants">${participants || `<li>${none}</li>`}</ul></section>
  ${answers}
  <section class="messages">
${messages}
  </section>
  <footer>${escapeHtml(t('tickets.transcript.generated', { date: fmtDate(new Date(), data.language) }))}</footer>
</div>
</body>
</html>`;

    function avatar(url: string | null | undefined, tag: string): string {
      const initial = escapeHtml((tag.replace(/^@/, '')[0] ?? '?').toUpperCase());
      return `<div class="avatar">${url ? `<img src="${escapeHtml(url)}" alt="">` : initial}</div>`;
    }
  }

  // ───────────── PDF ─────────────

  renderPdf(data: TranscriptData, filePath: string): Promise<void> {
    const t = translationService.bind(data.language);
    return new Promise<void>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: t('tickets.transcript.title', { number: data.ticketNumber }), Author: BRAND.name } });
      const stream = fs.createWriteStream(filePath);
      stream.on('finish', () => resolve());
      stream.on('error', reject);
      doc.on('error', reject);
      doc.pipe(stream);

      const BG = '#0b0a10';
      const PANEL = '#15131d';
      const TEXT = '#ece9f4';
      const MUTED = '#8f88a6';
      const VIOLET = '#7c3aed';
      const width = doc.page.width - 80;

      const paintBackground = () => {
        doc.save();
        doc.rect(0, 0, doc.page.width, doc.page.height).fill(BG);
        doc.restore();
      };
      paintBackground();
      doc.on('pageAdded', () => {
        paintBackground();
        doc.fillColor(TEXT);
      });

      // En-tête
      doc.save().roundedRect(40, 40, width, 70, 12).fill(PANEL).restore();
      doc.fillColor(VIOLET).font('Helvetica-Bold').fontSize(20).text(pdfSafe(t('tickets.transcript.title', { number: data.ticketNumber })), 56, 56, { width: width - 32 });
      doc.fillColor(MUTED).font('Helvetica').fontSize(11).text(pdfSafe(`${data.guildName}  •  ${BRAND.name}`), 56, 84, { width: width - 32 });
      doc.y = 128;

      // Métadonnées
      const none = t('tickets.transcript.none');
      const rows: [string, string][] = [
        ...(data.title ? ([[t('tickets.transcript.title_field'), data.title]] as [string, string][]) : []),
        [t('tickets.transcript.type'), data.typeLabel],
        [t('tickets.transcript.opened_by'), `${data.creator.tag} (${data.creator.id})`],
        [t('tickets.transcript.closed_by'), data.closedBy ? `${data.closedBy.tag} (${data.closedBy.id})` : none],
        [t('tickets.transcript.reason'), data.closeReason?.trim() || none],
        [t('tickets.transcript.opened_at'), fmtDate(data.openedAt, data.language)],
        [t('tickets.transcript.closed_at'), fmtDate(data.closedAt, data.language)],
        [t('tickets.transcript.duration'), formatDuration(this.durationSeconds(data), data.language)],
        [t('tickets.transcript.messages'), String(data.messages.length)],
        [t('tickets.transcript.participants'), data.participants.map((p) => `${p.tag}${p.staff ? ' [staff]' : ''}`).join(', ') || none],
      ];
      for (const [k, v] of rows) {
        doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(9).text(pdfSafe(k.toUpperCase()), 40, doc.y, { width, continued: false });
        doc.fillColor(TEXT).font('Helvetica').fontSize(11).text(pdfSafe(v), { width });
        doc.moveDown(0.3);
      }
      if (data.formAnswers.length) {
        doc.moveDown(0.5);
        doc.fillColor(VIOLET).font('Helvetica-Bold').fontSize(12).text(pdfSafe(t('tickets.info.answers')), { width });
        for (const a of data.formAnswers) {
          doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(pdfSafe(a.question), { width });
          doc.fillColor(TEXT).fontSize(11).text(pdfSafe(a.answer || none), { width });
          doc.moveDown(0.2);
        }
      }

      // Séparateur
      doc.moveDown(0.6);
      doc.save().moveTo(40, doc.y).lineTo(40 + width, doc.y).lineWidth(1).strokeColor(VIOLET).stroke().restore();
      doc.moveDown(0.8);

      // Messages
      if (!data.messages.length) {
        doc.fillColor(MUTED).font('Helvetica').fontSize(11).text(pdfSafe(t('tickets.transcript.no_messages')), { width, align: 'center' });
      }
      for (const m of data.messages) {
        const staff = data.participants.find((p) => p.id === m.authorId)?.staff;
        if (doc.y > doc.page.height - 120) doc.addPage();
        doc.fillColor(staff ? VIOLET : TEXT).font('Helvetica-Bold').fontSize(11).text(pdfSafe(m.authorTag), 40, doc.y, { width: width - 150, continued: true });
        doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(pdfSafe(fmtDate(m.createdAt, data.language)), { align: 'right' });
        if (m.content) doc.fillColor(TEXT).font('Helvetica').fontSize(11).text(pdfSafe(m.content), 40, doc.y, { width });
        for (const e of m.embeds) {
          const parts = [e.title, e.description].filter(Boolean).join(' — ');
          if (parts) doc.fillColor('#d8d3ea').font('Helvetica-Oblique').fontSize(10).text(pdfSafe(`[${t('tickets.transcript.embed')}] ${parts}`), 52, doc.y, { width: width - 12 });
        }
        for (const a of m.attachments) {
          doc.fillColor(VIOLET).font('Helvetica').fontSize(9).text(pdfSafe(`[${t('tickets.transcript.attachments')}] ${a.name}`), 52, doc.y, { width: width - 12, link: a.url, underline: true });
        }
        doc.moveDown(0.6);
      }

      doc.moveDown(1);
      doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(pdfSafe(t('tickets.transcript.generated', { date: fmtDate(new Date(), data.language) })), 40, doc.y, { width, align: 'center' });
      doc.end();
    });
  }
}

export const transcriptService = new TranscriptService();
