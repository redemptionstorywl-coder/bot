import { describe, expect, it, vi } from 'vitest';
import { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', () => ({ prisma: createPrismaMock() }));

import { pickWinners } from '../../src/services/GiveawayService';

describe('pickWinners', () => {
  const entries = Array.from({ length: 50 }, (_, i) => `user-${i}`);

  it('tire exactement le nombre de gagnants demandé, sans doublon', () => {
    for (let run = 0; run < 25; run++) {
      const winners = pickWinners(entries, 5);
      expect(winners).toHaveLength(5);
      expect(new Set(winners).size).toBe(5);
      for (const w of winners) expect(entries).toContain(w);
    }
  });

  it('retourne moins de gagnants quand le nombre de participants est insuffisant', () => {
    expect(pickWinners(['a', 'b'], 5).sort()).toEqual(['a', 'b']);
    expect(pickWinners([], 3)).toEqual([]);
    expect(pickWinners(entries, 0)).toEqual([]);
  });

  it('exclut les anciens gagnants (reroll)', () => {
    const exclude = entries.slice(0, 45);
    for (let run = 0; run < 25; run++) {
      const winners = pickWinners(entries, 3, exclude);
      expect(winners).toHaveLength(3);
      for (const w of winners) expect(exclude).not.toContain(w);
    }
    expect(pickWinners(['a', 'b'], 2, ['a', 'b'])).toEqual([]);
  });

  it('ignore les participations dupliquées', () => {
    const winners = pickWinners(['a', 'a', 'a', 'b'], 3);
    expect(winners.sort()).toEqual(['a', 'b']);
  });

  it('couvre tous les participants sur un grand nombre de tirages (pas de biais grossier)', () => {
    const seen = new Set<string>();
    for (let run = 0; run < 500; run++) for (const w of pickWinners(entries.slice(0, 10), 1)) seen.add(w);
    expect(seen.size).toBe(10);
  });
});
