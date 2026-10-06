-- Couleur des embeds par défaut : bleu #2F8BFF (au lieu du violet #7C3AED).

-- AlterTable
ALTER TABLE `GuildSettings` MODIFY `brandColor` VARCHAR(9) NOT NULL DEFAULT '#2F8BFF';

-- Données : les serveurs qui avaient gardé l'ancien violet par défaut (#7C3AED, ou sa forme décimale 8141037) passent au bleu
UPDATE `GuildSettings` SET `brandColor` = '#2F8BFF' WHERE UPPER(REPLACE(`brandColor`, '#', '')) IN ('7C3AED', '8141037');
