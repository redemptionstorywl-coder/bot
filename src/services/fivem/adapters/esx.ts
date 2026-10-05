import { FiveMFramework } from '@prisma/client';
import { asRecord, BaseAdapter, firstDefined, identifierList, normalizeSanctionType, toBool } from './base';
import type { NormalizedSanction, NormalizedStats } from '../schemas';

/**
 * Adaptateur ESX.
 * Stats attendues (export côté serveur) : { identifier, season?, stats?: {...} } ou à plat avec les clés ESX usuelles :
 *   kills, deaths, wins, played|games|matches, damage_dealt|damage, top10, xp, playtime (minutes)
 * Sanction (esx_adminplus / EasyAdmin style) : { identifier, type: 'ban'|'kick'|'warn', reason, time|duration (sec), admin|staff }
 */
export class EsxAdapter extends BaseAdapter {
  readonly framework = FiveMFramework.ESX;
  protected override maintenanceVars = ['esx_maintenance', 'maintenance', 'sv_maintenance'];

  normalizeStats(payload: unknown): NormalizedStats {
    const p = asRecord(payload);
    const s = { ...p, ...asRecord(p.stats), ...asRecord(p.data) };
    return this.parseStats({
      identifier: firstDefined(p, ['identifier', 'license', 'steam']),
      season: firstDefined(p, ['season']),
      mode: firstDefined(p, ['mode']) ?? 'increment',
      wins: firstDefined(s, ['wins', 'victories']) ?? 0,
      kills: firstDefined(s, ['kills']) ?? 0,
      deaths: firstDefined(s, ['deaths']) ?? 0,
      matches: firstDefined(s, ['matches', 'played', 'games']) ?? 0,
      damage: firstDefined(s, ['damage', 'damage_dealt', 'damageDealt']) ?? 0,
      top10: firstDefined(s, ['top10', 'top_10']) ?? 0,
      xp: firstDefined(s, ['xp', 'experience']) ?? 0,
      playtimeMinutes: firstDefined(s, ['playtimeMinutes', 'playtime', 'play_time']) ?? 0,
    });
  }

  normalizeSanction(payload: unknown): NormalizedSanction {
    const p = asRecord(payload);
    const target = asRecord(p.target);
    return this.parseSanction({
      identifier: firstDefined(p, ['identifier', 'license']) ?? firstDefined(target, ['identifier', 'license']),
      discordId: firstDefined(p, ['discordId', 'discord']) ?? firstDefined(target, ['discordId', 'discord']),
      identifiers: identifierList(firstDefined(p, ['identifiers']) ?? firstDefined(target, ['identifiers'])),
      type: normalizeSanctionType(firstDefined(p, ['type', 'action'])),
      reason: firstDefined(p, ['reason', 'motif']) ?? '',
      duration: firstDefined(p, ['duration', 'time', 'expire']),
      staff: firstDefined(p, ['staff', 'admin', 'author', 'source']) ?? '',
      syncDiscord: toBool(firstDefined(p, ['syncDiscord'])),
    });
  }
}
