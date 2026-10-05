import { describe, expect, it, vi } from 'vitest';
import { OverwriteType, PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { createPrismaMock } from '../helpers/prisma';

vi.mock('../../src/database/client', () => ({ prisma: createPrismaMock() }));

import {
  CREATE_COOLDOWN_MS,
  buildOverwrites,
  clampOverwriteBits,
  decideLeave,
  decideLobbyJoin,
  missingBotPermissions,
  pickNewOwner,
  planStartupCleanup,
  type StoredTempChannel,
} from '../../src/services/TempVoiceService';

const LOBBY = '500000000000000001';
const OWNED = '500000000000000002';
const NOW = 1_000_000;

const join = (over: Partial<Parameters<typeof decideLobbyJoin>[0]> = {}) =>
  decideLobbyJoin({ joinedChannelId: LOBBY, lobbyIds: [LOBBY], moduleEnabled: true, ownedChannelId: null, busy: false, lastCreatedAt: undefined, now: NOW, ...over });

describe('decideLobbyJoin : créer ou déplacer', () => {
  it('lobby rejoint sans salon existant → création', () => {
    expect(join()).toEqual({ kind: 'create' });
  });
  it('salon non lobby, module coupé ou départ du vocal → rien', () => {
    expect(join({ joinedChannelId: OWNED })).toEqual({ kind: 'ignore' });
    expect(join({ moduleEnabled: false })).toEqual({ kind: 'ignore' });
    expect(join({ joinedChannelId: null })).toEqual({ kind: 'ignore' });
    expect(join({ lobbyIds: [] })).toEqual({ kind: 'ignore' });
  });
  it('le membre possède déjà un salon actif → déplacé dedans (pas de second salon)', () => {
    expect(join({ ownedChannelId: OWNED })).toEqual({ kind: 'move', channelId: OWNED });
    // même pendant la limite de création
    expect(join({ ownedChannelId: OWNED, lastCreatedAt: NOW - 1000 })).toEqual({ kind: 'move', channelId: OWNED });
  });
  it('limite : une création par membre toutes les 10 s', () => {
    expect(join({ lastCreatedAt: NOW - 3000 })).toEqual({ kind: 'rate_limited', retryInMs: CREATE_COOLDOWN_MS - 3000 });
    expect(join({ lastCreatedAt: NOW - CREATE_COOLDOWN_MS })).toEqual({ kind: 'create' });
  });
  it('création déjà en cours pour ce membre → ignoré (double événement)', () => {
    expect(join({ busy: true })).toEqual({ kind: 'ignore' });
  });
});

describe('decideLeave : suppression et transfert', () => {
  const joinedAt = new Map([
    ['owner', 1],
    ['a', 30],
    ['b', 10],
  ]);
  it('plus personne → suppression programmée (délai de grâce)', () => {
    expect(decideLeave({ remainingHumanIds: [], leaverId: 'a', ownerId: 'owner', transferEnabled: true, joinedAt })).toEqual({ kind: 'schedule_delete' });
  });
  it('le créateur part, d’autres restent → transfert au plus ancien', () => {
    expect(decideLeave({ remainingHumanIds: ['a', 'b'], leaverId: 'owner', ownerId: 'owner', transferEnabled: true, joinedAt })).toEqual({ kind: 'transfer', newOwnerId: 'b' });
  });
  it('transfert désactivé ou départ d’un autre membre → le salon reste tel quel', () => {
    expect(decideLeave({ remainingHumanIds: ['a', 'b'], leaverId: 'owner', ownerId: 'owner', transferEnabled: false, joinedAt })).toEqual({ kind: 'keep' });
    expect(decideLeave({ remainingHumanIds: ['owner', 'b'], leaverId: 'a', ownerId: 'owner', transferEnabled: true, joinedAt })).toEqual({ kind: 'keep' });
  });
  it('pickNewOwner : heure d’arrivée inconnue → ordre de la liste', () => {
    expect(pickNewOwner(['x', 'y'], new Map(), 'owner')).toBe('x');
    expect(pickNewOwner(['x', 'y'], new Map([['y', 5]]), 'owner')).toBe('y');
    expect(pickNewOwner(['owner'], new Map(), 'owner')).toBeNull();
  });
});

describe('planStartupCleanup : reprise après redémarrage', () => {
  const row = (channelId: string, guildId = 'g1'): StoredTempChannel => ({ channelId, guildId, ownerId: 'u', lobbyId: LOBBY, createdAt: new Date() });
  it('vides → supprimés ; disparus → oubliés ; occupés → gardés ; serveur indisponible → gardé', () => {
    const plan = planStartupCleanup([row('empty'), row('gone'), row('busy'), row('lost', 'g-missing'), row('later', 'g-down')], (r) => {
      if (r.guildId === 'g-missing') return { state: 'guild_missing' };
      if (r.guildId === 'g-down') return { state: 'guild_unavailable' };
      if (r.channelId === 'gone') return { state: 'channel_missing' };
      return { state: 'present', humans: r.channelId === 'busy' ? 2 : 0 };
    });
    expect(plan.remove).toEqual(['empty']);
    expect(plan.forget).toEqual(['gone', 'lost']);
    expect(plan.keep.map((r) => r.channelId)).toEqual(['busy', 'later']);
  });
});

describe('permissions', () => {
  it('missingBotPermissions : administrateur → rien ; sinon la liste manquante', () => {
    expect(missingBotPermissions(new PermissionsBitField(PermissionFlagsBits.Administrator))).toEqual([]);
    expect(missingBotPermissions(new PermissionsBitField([PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect]))).toEqual([PermissionFlagsBits.MoveMembers]);
    expect(missingBotPermissions(null)).toHaveLength(4);
  });

  it('clampOverwriteBits : jamais un droit que le bot n’a pas, ni « Gérer les rôles » hors administrateur', () => {
    const bot = PermissionFlagsBits.ManageChannels | PermissionFlagsBits.Connect | PermissionFlagsBits.ManageRoles;
    expect(clampOverwriteBits(PermissionFlagsBits.Connect | PermissionFlagsBits.BanMembers | PermissionFlagsBits.ManageRoles, bot)).toBe(PermissionFlagsBits.Connect);
    expect(clampOverwriteBits(PermissionFlagsBits.BanMembers, PermissionFlagsBits.Administrator)).toBe(PermissionFlagsBits.BanMembers);
  });

  it('buildOverwrites : copie du lobby + droits du créateur + accès du bot', () => {
    const botPerms = new PermissionsBitField(PermissionFlagsBits.Administrator).bitfield;
    const everyone = { id: 'everyone', type: OverwriteType.Role, allow: 0n, deny: PermissionFlagsBits.Speak };
    const out = buildOverwrites({ lobby: [everyone], botId: 'bot', botPerms, ownerId: 'owner', ownerPermissions: true }) as { id: string; allow: bigint; deny: bigint }[];
    expect(out.find((o) => o.id === 'everyone')).toMatchObject({ deny: PermissionFlagsBits.Speak });
    const owner = out.find((o) => o.id === 'owner')!;
    expect(owner.allow & PermissionFlagsBits.ManageChannels).toBe(PermissionFlagsBits.ManageChannels);
    expect(owner.allow & PermissionFlagsBits.MoveMembers).toBe(PermissionFlagsBits.MoveMembers);
    expect(out.find((o) => o.id === 'bot')!.allow & PermissionFlagsBits.MoveMembers).toBe(PermissionFlagsBits.MoveMembers);
    const noOwner = buildOverwrites({ lobby: [], botId: 'bot', botPerms, ownerId: 'owner', ownerPermissions: false }) as { id: string }[];
    expect(noOwner.map((o) => o.id)).toEqual(['bot']);
  });
});
