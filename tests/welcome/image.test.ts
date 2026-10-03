import { describe, expect, it } from 'vitest';
import { escapeXml, fitText, WelcomeImageService, WELCOME_IMAGE_HEIGHT, WELCOME_IMAGE_WIDTH } from '../../src/services/WelcomeImageService';

describe('escapeXml', () => {
  it('échappe les 5 caractères spéciaux XML', () => {
    expect(escapeXml(`Tom & Jerry <b>"quote" 'apos'</b>`)).toBe('Tom &amp; Jerry &lt;b&gt;&quot;quote&quot; &apos;apos&apos;&lt;/b&gt;');
  });
  it('laisse le texte simple intact et tolère les valeurs nulles', () => {
    expect(escapeXml('Bienvenue Alice')).toBe('Bienvenue Alice');
    expect(escapeXml(undefined as unknown as string)).toBe('');
  });
});

describe('fitText', () => {
  it('tronque avec une ellipse', () => {
    expect(fitText('abcdefghij', 5)).toBe('abcd…');
    expect(fitText('  court  ', 10)).toBe('court');
  });
});

describe('WelcomeImageService', () => {
  const service = new WelcomeImageService();
  it('insère le texte échappé dans le SVG (pas d’injection)', () => {
    const svg = service.buildOverlaySvg({ title: '<script>x</script>', subtitle: 'A & B', accent: '#7c3aed', width: 1024, height: 450, avatarSize: 180 });
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;SCRIPT&gt;X&lt;/SCRIPT&gt;');
    expect(svg).toContain('A &amp; B');
    expect(svg).toContain('#7c3aed');
  });
  it('génère un PNG 1024×450 sans réseau (fond sombre, pas d’avatar)', async () => {
    const buf = await service.generate({ title: 'BIENVENUE', subtitle: 'alice · membre #42', avatarUrl: null, backgroundUrl: null });
    expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    // IHDR : largeur / hauteur big-endian aux offsets 16 et 20
    expect(buf.readUInt32BE(16)).toBe(WELCOME_IMAGE_WIDTH);
    expect(buf.readUInt32BE(20)).toBe(WELCOME_IMAGE_HEIGHT);
  }, 20_000);
  it('tryGenerate ne lance jamais', async () => {
    const buf = await service.tryGenerate({ title: 'X', avatarUrl: 'not-a-url', backgroundUrl: 'ftp://invalid' });
    expect(buf === null || Buffer.isBuffer(buf)).toBe(true);
  }, 20_000);
});
