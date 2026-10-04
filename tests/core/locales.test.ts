import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../../src/locales');
const flat = (o: Record<string, unknown>, p = ''): [string, string][] =>
  Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? flat(v as Record<string, unknown>, `${p}${k}.`) : [[`${p}${k}`, String(v)] as [string, string]]));
const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');

const languages = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
const frFiles = fs.readdirSync(path.join(root, 'fr')).filter((f) => f.endsWith('.json'));

describe('locales', () => {
  it('fr est la référence et contient tous les namespaces', () => {
    expect(frFiles.length).toBeGreaterThan(10);
  });

  it('seules les locales fr et en existent', () => {
    expect(languages.sort()).toEqual(['en', 'fr']);
  });

  for (const lang of languages.filter((l) => l !== 'fr')) {
    const dir = path.join(root, lang);
    describe(lang, () => {
      it('aucun fichier en trop', () => {
        expect(fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()).toEqual([...frFiles].sort());
      });
      for (const file of frFiles) {
        it(`${file} : mêmes clés et mêmes placeholders que fr`, () => {
          const fr = Object.fromEntries(flat(JSON.parse(fs.readFileSync(path.join(root, 'fr', file), 'utf8'))));
          const target = path.join(dir, file);
          expect(fs.existsSync(target), `${lang}/${file} manquant`).toBe(true);
          const tr = Object.fromEntries(flat(JSON.parse(fs.readFileSync(target, 'utf8'))));
          expect(Object.keys(tr).sort()).toEqual(Object.keys(fr).sort());
          for (const [k, v] of Object.entries(fr)) expect(placeholders(tr[k]!), `${lang}/${file} ${k}`).toBe(placeholders(v));
        });
      }
    });
  }
});
