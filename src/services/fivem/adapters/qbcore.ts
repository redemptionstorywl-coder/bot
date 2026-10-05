import { FiveMFramework } from '@prisma/client';
import { asRecord, BaseAdapter, firstDefined, identifierList, normalizeSanctionType, toBool } from './base';
import type { NormalizedSanction, NormalizedStats } from '../schemas';

/**
 * Adaptateur QBCore.
 * Stats : { license|identifier, citizenid?, season?, stats?|metadata?: { wins, kills, deaths, matches, damage, top10, xp, playtime } }
 *   → identifiant = license si présent, sinon `citizenid:<cid>`.
 * Sanction (qb-adminmenu style) : { license|citizenid, action|type: 'ban'|'kick'|'warn', reason, expire (sec), admin }
 */
export class QbCoreAdapter extends BaseAdapter {
  readonly framework = FiveMFramework.QBCORE;
  protected override maintenanceVars = ['qb_maintenance', 'maintenance', 'sv_maintenance'];

  private resolveIdentifier(p: Record<string, unknown>): unknown {
    const direct = firstDefined(p, ['identifier', 'license']);
    if (direct) return direct;
    const cid = firstDefined(p, ['citizenid', 'citizenId']);
    return cid !== undefined ? `citizenid:${String(cid)}` : undefined;
  }

  normalizeStats(payload: unknown): NormalizedStats {
    const p = asRecord(payload);
    const s = { ...p, ...asRecord(p.metadata), ...asRecord(p.stats) };
    return this.parseStats({
      identifier: this.resolveIdentifier(p),
      season: firstDefined(p, ['season']),
      mode: firstDefined(p, ['mode']) ?? 'increment',
      wins: firstDefined(s, ['wins']) ?? 0,
      kills: firstDefined(s, ['kills']) ?? 0,
      deaths: firstDefined(s, ['deaths']) ?? 0,
      matches: firstDefined(s, ['matches', 'games', 'rounds']) ?? 0,
      damage: firstDefined(s, ['damage', 'damageDealt']) ?? 0,
      top10: firstDefined(s, ['top10']) ?? 0,
      xp: firstDefined(s, ['xp']) ?? 0,
      playtimeMinutes: firstDefined(s, ['playtimeMinutes', 'playtime']) ?? 0,
    });
  }

  normalizeSanction(payload: unknown): NormalizedSanction {
    const p = asRecord(payload);
    return this.parseSanction({
      identifier: this.resolveIdentifier(p),
      discordId: firstDefined(p, ['discordId', 'discord']),
      identifiers: identifierList(firstDefined(p, ['identifiers'])),
      type: normalizeSanctionType(firstDefined(p, ['type', 'action'])),
      reason: firstDefined(p, ['reason']) ?? '',
      duration: firstDefined(p, ['duration', 'expire', 'time']),
      staff: firstDefined(p, ['staff', 'admin', 'source']) ?? '',
      syncDiscord: toBool(firstDefined(p, ['syncDiscord'])),
    });
  }
}
