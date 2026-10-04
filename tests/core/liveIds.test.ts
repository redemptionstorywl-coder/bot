import { describe, expect, it } from 'vitest';
import type { Guild } from 'discord.js';
import { liveChannel, liveChannels, liveRole, liveRoles } from '../../src/utils/liveIds';

const guild = { roles: { cache: new Map([['1', {}]]) }, channels: { cache: new Map([['10', {}]]) } } as unknown as Guild;

describe('liveIds', () => {
  it('écarte les rôles et salons supprimés', () => {
    expect(liveRoles(guild, ['1', '2', null])).toEqual(['1']);
    expect(liveRole(guild, '2')).toBeNull();
    expect(liveChannels(guild, ['10', '11'])).toEqual(['10']);
    expect(liveChannel(guild, '10')).toBe('10');
  });
  it('sans serveur, garde les IDs (contexte hors guild)', () => {
    expect(liveRoles(null, ['1', undefined])).toEqual(['1']);
    expect(liveChannel(undefined, '5')).toBe('5');
  });
});
