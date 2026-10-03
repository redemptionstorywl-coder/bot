import { describe, expect, it } from 'vitest';
import { formatDuration, parseDateInput, parseDuration } from '../../src/utils/time';

describe('parseDuration', () => {
  it('parse des durées composées', () => {
    expect(parseDuration('1h30m')).toBe(5400);
    expect(parseDuration('2d')).toBe(172800);
    expect(parseDuration('45 min')).toBe(2700);
    expect(parseDuration('1w')).toBe(604800);
  });
  it('retourne null pour une valeur invalide', () => {
    expect(parseDuration('abc')).toBeNull();
    expect(parseDuration('')).toBeNull();
  });
  it('nombre seul = minutes', () => {
    expect(parseDuration('10')).toBe(600);
  });
});

describe('formatDuration', () => {
  it('formate en français et anglais', () => {
    expect(formatDuration(90061, 'fr')).toBe('1j 1h 1m');
    expect(formatDuration(90061, 'en')).toBe('1d 1h 1m');
    expect(formatDuration(0)).toBe('0s');
  });
});

describe('parseDateInput', () => {
  it('parse les formats FR, ISO et relatifs', () => {
    const now = new Date('2025-01-01T00:00:00');
    expect(parseDateInput('31/01/2025 20:00')?.getHours()).toBe(20);
    expect(parseDateInput('2025-02-01 08:30')?.getMinutes()).toBe(30);
    expect(parseDateInput('in 2h', now)?.getTime()).toBe(now.getTime() + 7200_000);
    expect(parseDateInput('n/a')).toBeNull();
  });
});
