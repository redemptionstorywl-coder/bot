import { describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', () => ({ prisma: createPrismaMock() }));

import { computeResults, parseOptionsInput, renderBar } from '../../src/services/PollService';

describe('renderBar', () => {
  it('rend une barre de 10 cases proportionnelle', () => {
    expect(renderBar(0, 0)).toBe('░░░░░░░░░░');
    expect(renderBar(5, 10)).toBe('█████░░░░░');
    expect(renderBar(10, 10)).toBe('██████████');
    expect(renderBar(1, 3)).toBe('███░░░░░░░');
  });
  it('respecte une taille personnalisée', () => {
    expect(renderBar(1, 2, 4)).toBe('██░░');
  });
});

describe('computeResults', () => {
  const votes = [
    { userId: 'u1', optionIndex: 0 },
    { userId: 'u2', optionIndex: 0 },
    { userId: 'u3', optionIndex: 1 },
    { userId: 'u4', optionIndex: 2 },
  ];

  it('compte les voix, pourcentages et barres par option', () => {
    const r = computeResults(3, votes);
    expect(r.counts).toEqual([2, 1, 1]);
    expect(r.total).toBe(4);
    expect(r.voters).toBe(4);
    expect(r.percentages).toEqual([50, 25, 25]);
    expect(r.bars).toEqual(['█████░░░░░', '███░░░░░░░', '███░░░░░░░']);
  });

  it('distingue votants et voix en multi-sélection', () => {
    const r = computeResults(2, [
      { userId: 'u1', optionIndex: 0 },
      { userId: 'u1', optionIndex: 1 },
      { userId: 'u2', optionIndex: 1 },
    ]);
    expect(r.counts).toEqual([1, 2]);
    expect(r.total).toBe(3);
    expect(r.voters).toBe(2);
  });

  it('ignore les index hors limites et gère zéro vote', () => {
    const r = computeResults(2, [{ userId: 'u1', optionIndex: 7 }]);
    expect(r.counts).toEqual([0, 0]);
    expect(r.total).toBe(0);
    expect(r.percentages).toEqual([0, 0]);
    expect(r.bars[0]).toBe('░░░░░░░░░░');
  });
});

describe('parseOptionsInput', () => {
  it('découpe sur | et numérote les options', () => {
    const opts = parseOptionsInput(' Rouge | Vert|Bleu ');
    expect(opts?.map((o) => o.label)).toEqual(['Rouge', 'Vert', 'Bleu']);
    expect(opts?.[0]?.emoji).toBe('1️⃣');
  });
  it('refuse moins de 2 ou plus de 10 options', () => {
    expect(parseOptionsInput('Seul')).toBeNull();
    expect(parseOptionsInput(Array.from({ length: 11 }, (_, i) => `o${i}`).join('|'))).toBeNull();
  });
});
