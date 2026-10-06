import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', () => ({ prisma: createPrismaMock() }));

import { TranscriptService, escapeHtml, type TranscriptData } from '../../src/services/TranscriptService';

let dir: string;
let service: TranscriptService;

const data: TranscriptData = {
  guildId: '123456789012345678',
  guildName: 'Redemption Story WL',
  guildIcon: null,
  ticketNumber: 42,
  ticketId: 9,
  typeLabel: 'Support',
  typeEmoji: '🎫',
  creator: { id: '1', tag: '@alice', staff: false },
  title: 'Mon jeu plante <au lancement>',
  closedBy: { id: '2', tag: '@bob', staff: true },
  closeReason: 'Résolu <ok>',
  openedAt: new Date('2026-01-01T10:00:00Z'),
  closedAt: new Date('2026-01-01T11:30:00Z'),
  participants: [
    { id: '1', tag: '@alice', staff: false },
    { id: '2', tag: '@bob', staff: true },
  ],
  formAnswers: [{ question: 'Décrivez votre demande', answer: 'Mon jeu crash & plante' }],
  messages: [
    { messageId: 'm1', authorId: '1', authorTag: '@alice', content: 'Bonjour <script>alert("x")</script>', attachments: [{ name: 'log.txt', url: 'https://cdn.example/log.txt' }], embeds: [], createdAt: new Date('2026-01-01T10:01:00Z') },
    { messageId: 'm2', authorId: '2', authorTag: '@bob', content: 'Je regarde ça', attachments: [], embeds: [{ title: 'Info', description: 'Détails' }], createdAt: new Date('2026-01-01T10:05:00Z') },
  ],
  language: 'fr',
};

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-transcripts-'));
  service = new TranscriptService(dir);
});

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('TranscriptService', () => {
  it('escapeHtml neutralise le HTML', () => {
    expect(escapeHtml('<b>"a" & \'b\'</b>')).toBe('&lt;b&gt;&quot;a&quot; &amp; &#39;b&#39;&lt;/b&gt;');
    expect(escapeHtml(null)).toBe('');
  });

  it('génère un TXT complet et lisible', () => {
    const txt = service.renderTxt(data);
    expect(txt).toContain('Ticket #42');
    expect(txt).toContain('@alice (1)');
    expect(txt).toContain('Bonjour <script>alert("x")</script>');
    expect(txt).toContain('log.txt <https://cdn.example/log.txt>');
    expect(txt).toContain('[Embed] Info — Détails');
    expect(txt).toContain('1h 30m');
    expect(txt).toContain('Résolu <ok>');
    expect(txt).toContain('Titre: Mon jeu plante <au lancement>');
    expect(txt).not.toContain('Pris en charge');
  });

  it('génère un HTML sombre avec échappement des messages', () => {
    const html = service.renderHtml(data);
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('--violet: #7c3aed');
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(html).toContain('Résolu &lt;ok&gt;');
    expect(html).toContain('class="msg staff"');
    expect(html).toContain('href="https://cdn.example/log.txt"');
    expect(html).toContain('Mon jeu crash &amp; plante');
    expect(html).toContain('Mon jeu plante &lt;au lancement&gt;');
  });

  it('écrit les trois fichiers (html, txt, pdf) dans uploads/transcripts/<guildId>/', async () => {
    const files = await service.generate(data);
    expect(files.messageCount).toBe(2);
    expect(files.durationSeconds).toBe(5400);
    expect(files.htmlPath).toBe(path.join(dir, '123456789012345678', 'ticket-42.html'));
    for (const p of [files.htmlPath, files.txtPath, files.pdfPath]) expect(fs.existsSync(p)).toBe(true);
    const pdf = fs.readFileSync(files.pdfPath);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1000);
    expect(fs.readFileSync(files.htmlPath, 'utf8')).toContain('Ticket #42');
  });

  it('gère un ticket sans message', () => {
    const empty = { ...data, messages: [] };
    expect(service.renderTxt(empty)).toContain('Aucun message enregistré');
    expect(service.renderHtml(empty)).toContain('Aucun message enregistré');
  });

  it('rend en anglais quand la langue est en', () => {
    const txt = service.renderTxt({ ...data, language: 'en' });
    expect(txt).toContain('Opened by: @alice');
    expect(txt).toContain('1h 30m');
  });
});
