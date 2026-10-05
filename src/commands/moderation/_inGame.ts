import type { ChatInputCommandInteraction } from 'discord.js';
import type { InteractionContext } from '../../structures/types';
import { fivemService } from '../../services/FiveMService';
import { banGameTargets } from '../../services/fivem/sync';

/**
 * Option `en_jeu` de /ban, /tempban et /unban : appliquer aussi l'action sur les serveurs FiveM.
 * Non renseignée = réglage « Ban Discord → jeu » (`syncBansToGame`) de chaque serveur.
 */
export const IN_GAME_OPTION = 'en_jeu';
export const IN_GAME_DESCRIPTION = 'Appliquer aussi en jeu (FiveM) — vide = réglage du serveur FiveM';

export function readInGame(interaction: ChatInputCommandInteraction): boolean | null {
  return interaction.options.getBoolean(IN_GAME_OPTION);
}

/** Ligne de réponse « en jeu » (nombre de serveurs FiveM concernés) ; aucune ligne si le serveur Discord n'a pas de serveur FiveM. */
export async function inGameLines(ctx: InteractionContext, guildId: string, inGame: boolean | null): Promise<string[]> {
  const servers = await fivemService.listServers(guildId).catch(() => []);
  if (!servers.length) return [];
  const count = banGameTargets(servers, inGame).length;
  return [count ? ctx.t('moderation.reply.in_game', { count }) : ctx.t('moderation.reply.not_in_game')];
}
