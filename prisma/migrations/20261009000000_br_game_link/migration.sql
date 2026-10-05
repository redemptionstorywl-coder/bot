-- Rôles Discord → groupes en jeu (ACE), pseudo de compte fixé par le gamemode, action SET_GROUPS,
-- configuration de l'affichage Battle Royale (message de classement en direct, salon /stat).

-- AlterTable
ALTER TABLE `FiveMServer` ADD COLUMN `roleGroups` JSON NULL;

-- AlterTable
ALTER TABLE `FiveMPlayer` ADD COLUMN `gameName` VARCHAR(128) NULL;

-- AlterTable
ALTER TABLE `FiveMPendingAction` MODIFY `type` ENUM('BAN', 'UNBAN', 'KICK', 'MESSAGE', 'SET_GROUPS') NOT NULL;

-- CreateTable
CREATE TABLE `BattleRoyaleConfig` (
    `guildId` VARCHAR(32) NOT NULL,
    `leaderboardChannelId` VARCHAR(32) NULL,
    `leaderboardMessageId` VARCHAR(32) NULL,
    `leaderboardSize` INTEGER NOT NULL DEFAULT 10,
    `statChannelId` VARCHAR(32) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`guildId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
