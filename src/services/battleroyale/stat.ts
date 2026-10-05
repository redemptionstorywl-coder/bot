/**
 * /stat : fonctions pures (testées dans tests/battleroyale/stat.test.ts) — lecture de l'option `joueur`,
 * choix d'un joueur parmi les pseudos trouvés, salon dédié.
 */

/** Préfixe de la valeur d'un choix d'autocomplete (`u:<ID Discord>`) : sélection exacte, sans ambiguïté de pseudo. */
export const STAT_USER_PREFIX = 'u:';
const SNOWFLAKE = /^\d{15,22}$/;

export type StatTarget = { kind: 'self' } | { kind: 'user'; userId: string } | { kind: 'name'; query: string };

/**
 * Option `joueur` : vide → soi-même ; choix d'autocomplete `u:<id>`, mention `<@id>` / `<@!id>` ou ID brut → membre ;
 * sinon pseudo en jeu à rechercher.
 */
export function parseStatTarget(raw: string | null | undefined): StatTarget {
  const v = (raw ?? '').trim();
  if (!v) return { kind: 'self' };
  if (v.startsWith(STAT_USER_PREFIX) && SNOWFLAKE.test(v.slice(STAT_USER_PREFIX.length))) return { kind: 'user', userId: v.slice(STAT_USER_PREFIX.length) };
  const mention = v.match(/^<@!?(\d{15,22})>$/);
  if (mention) return { kind: 'user', userId: mention[1]! };
  if (SNOWFLAKE.test(v)) return { kind: 'user', userId: v };
  return { kind: 'name', query: v.slice(0, 64) };
}

/** Normalisation de comparaison : minuscules, sans accents, espaces réduits. */
export function normalizeName(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Meilleur joueur pour un pseudo saisi : égalité exacte, puis début, puis contenu (ordre des candidats conservé) ; null si aucun. */
export function pickByName<T extends { userId: string; name: string }>(candidates: readonly T[], query: string): T | null {
  const q = normalizeName(query);
  if (!q) return null;
  const norm = candidates.map((c) => ({ c, n: normalizeName(c.name) }));
  return norm.find((x) => x.n === q)?.c ?? norm.find((x) => x.n.startsWith(q))?.c ?? norm.find((x) => x.n.includes(q))?.c ?? null;
}

/**
 * Salon dédié à /stat : `ok` si aucun salon n'est configuré, si l'on est dans ce salon ou dans un fil de ce salon ;
 * sinon `redirect` (réponse éphémère avec un lien vers le salon).
 */
export function statChannelGate(statChannelId: string | null | undefined, channelId: string | null | undefined, parentId?: string | null): 'ok' | 'redirect' {
  if (!statChannelId) return 'ok';
  if (channelId === statChannelId || (parentId && parentId === statChannelId)) return 'ok';
  return 'redirect';
}
