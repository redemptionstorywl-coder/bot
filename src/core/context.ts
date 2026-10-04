import type { BaseInteraction, GuildMember } from 'discord.js';
import type { RedemptionClient } from './Client';
import type { InteractionContext } from '../structures/types';
import { guildConfigService } from '../services/GuildConfigService';
import { translationService } from '../services/TranslationService';

/**
 * Résout le contexte d'une interaction : config du serveur + langue (celle du serveur) + traducteur.
 */
export async function resolveContext(client: RedemptionClient, interaction: BaseInteraction): Promise<InteractionContext> {
  const config = interaction.guild ? await guildConfigService.getOrCreate(interaction.guild) : null;
  const lang = translationService.resolveLanguage(config?.defaultLanguage);
  return { client, config, lang, t: translationService.bind(lang) };
}

/** Contexte pour un membre hors interaction (bienvenue, logs…). */
export async function resolveMemberContext(client: RedemptionClient, member: GuildMember | { guild: { id: string }; id: string; user?: { id: string } }): Promise<InteractionContext> {
  const config = await guildConfigService.get(member.guild.id);
  const lang = translationService.resolveLanguage(config?.defaultLanguage);
  return { client, config, lang, t: translationService.bind(lang) };
}
