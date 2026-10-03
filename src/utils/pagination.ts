import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, EmbedBuilder, type ChatInputCommandInteraction, type ButtonInteraction, type InteractionResponse, type Message } from 'discord.js';

export interface PaginateOptions {
  pages: EmbedBuilder[];
  /** Durée du collector en ms */
  timeMs?: number;
  ephemeral?: boolean;
  userId: string;
}

/**
 * Pagination par boutons (◀ ▶). Seul l'auteur peut naviguer.
 */
export async function paginate(interaction: ChatInputCommandInteraction | ButtonInteraction, opts: PaginateOptions): Promise<void> {
  const { pages, timeMs = 120_000, ephemeral = false, userId } = opts;
  if (pages.length === 0) throw new Error('paginate: aucune page');
  let index = 0;

  const row = () =>
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId('pg:first').setEmoji('⏮️').setStyle(ButtonStyle.Secondary).setDisabled(index === 0),
      new ButtonBuilder().setCustomId('pg:prev').setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(index === 0),
      new ButtonBuilder().setCustomId('pg:page').setLabel(`${index + 1} / ${pages.length}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId('pg:next').setEmoji('▶️').setStyle(ButtonStyle.Secondary).setDisabled(index === pages.length - 1),
      new ButtonBuilder().setCustomId('pg:last').setEmoji('⏭️').setStyle(ButtonStyle.Secondary).setDisabled(index === pages.length - 1),
    );

  const payload = () => ({ embeds: [pages[index]!], components: pages.length > 1 ? [row()] : [] });

  let message: Message | InteractionResponse;
  if (interaction.deferred || interaction.replied) message = await interaction.editReply(payload());
  else message = await interaction.reply({ ...payload(), ephemeral, fetchReply: true });

  if (pages.length <= 1) return;

  const collector = message.createMessageComponentCollector({ componentType: ComponentType.Button, time: timeMs });
  collector.on('collect', async (i) => {
    if (i.user.id !== userId) {
      await i.reply({ content: '⛔', ephemeral: true }).catch(() => null);
      return;
    }
    switch (i.customId) {
      case 'pg:first':
        index = 0;
        break;
      case 'pg:prev':
        index = Math.max(0, index - 1);
        break;
      case 'pg:next':
        index = Math.min(pages.length - 1, index + 1);
        break;
      case 'pg:last':
        index = pages.length - 1;
        break;
    }
    await i.update(payload()).catch(() => null);
  });
  collector.on('end', async () => {
    await interaction.editReply({ components: [] }).catch(() => null);
  });
}

/** Découpe un tableau en pages de taille `size`. */
export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
