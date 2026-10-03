import { describe, expect, it } from 'vitest';
import { buildCustomId, parseCustomId } from '../../src/utils/customId';

describe('customId', () => {
  it('construit et parse un customId', () => {
    const id = buildCustomId('ticket', 'close', 42);
    expect(id).toBe('ticket:close:42');
    expect(parseCustomId(id)).toEqual({ namespace: 'ticket', args: ['close', '42'] });
  });
  it('encode les caractères spéciaux', () => {
    const id = buildCustomId('x', 'a:b', 'c d');
    expect(parseCustomId(id).args).toEqual(['a:b', 'c d']);
  });
  it('refuse les identifiants trop longs', () => {
    expect(() => buildCustomId('x', 'a'.repeat(120))).toThrow();
  });
});
