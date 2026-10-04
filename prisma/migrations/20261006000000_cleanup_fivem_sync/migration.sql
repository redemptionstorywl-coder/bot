-- DropForeignKey
ALTER TABLE `UserLanguage` DROP FOREIGN KEY `UserLanguage_userId_fkey`;

-- DropForeignKey
ALTER TABLE `UserLanguage` DROP FOREIGN KEY `UserLanguage_guildId_fkey`;

-- DropForeignKey
ALTER TABLE `LanguageRole` DROP FOREIGN KEY `LanguageRole_guildId_fkey`;

-- DropForeignKey
ALTER TABLE `Translation` DROP FOREIGN KEY `Translation_guildId_fkey`;

-- AlterTable
ALTER TABLE `GuildSettings` DROP COLUMN `autoTranslate`,
    DROP COLUMN `enabledLanguages`,
    DROP COLUMN `languageChannels`,
    DROP COLUMN `languagePanelChannelId`,
    DROP COLUMN `languagePanelMessageId`,
    DROP COLUMN `translationMode`;

-- AlterTable
ALTER TABLE `WelcomeConfig` DROP COLUMN `languagePromptEnabled`;

-- AlterTable
ALTER TABLE `Announcement` DROP COLUMN `sourceLanguage`,
    DROP COLUMN `targetLanguages`,
    DROP COLUMN `translations`;

-- AlterTable
ALTER TABLE `FiveMServer` ADD COLUMN `linkedRoleId` VARCHAR(32) NULL,
    ADD COLUMN `nicknameFormat` VARCHAR(64) NOT NULL DEFAULT '{name}',
    ADD COLUMN `onlineRoleId` VARCHAR(32) NULL,
    ADD COLUMN `playerCountChannelId` VARCHAR(32) NULL,
    ADD COLUMN `requireDiscord` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `requireRoleId` VARCHAR(32) NULL,
    ADD COLUMN `requireWhitelist` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `syncBansToDiscord` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `syncBansToGame` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `syncKicks` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `syncNicknames` BOOLEAN NOT NULL DEFAULT true;

-- DropTable
DROP TABLE `UserLanguage`;

-- DropTable
DROP TABLE `LanguageRole`;

-- DropTable
DROP TABLE `Translation`;

-- DropTable
DROP TABLE `MachineTranslation`;

-- CreateTable
CREATE TABLE `FiveMPlayer` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `guildId` VARCHAR(32) NOT NULL,
    `discordId` VARCHAR(32) NULL,
    `license` VARCHAR(128) NULL,
    `steam` VARCHAR(128) NULL,
    `fivemId` VARCHAR(128) NULL,
    `name` VARCHAR(128) NOT NULL,
    `serverKey` VARCHAR(64) NULL,
    `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `sessionStartedAt` DATETIME(3) NULL,
    `playtimeMinutes` INTEGER NOT NULL DEFAULT 0,
    `online` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `FiveMPlayer_guildId_discordId_idx`(`guildId`, `discordId`),
    INDEX `FiveMPlayer_guildId_online_idx`(`guildId`, `online`),
    UNIQUE INDEX `FiveMPlayer_guildId_license_key`(`guildId`, `license`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FiveMPendingAction` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `guildId` VARCHAR(32) NOT NULL,
    `serverKey` VARCHAR(64) NOT NULL,
    `type` ENUM('BAN', 'UNBAN', 'KICK', 'MESSAGE') NOT NULL,
    `payload` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `deliveredAt` DATETIME(3) NULL,

    INDEX `FiveMPendingAction_guildId_serverKey_deliveredAt_idx`(`guildId`, `serverKey`, `deliveredAt`),
    INDEX `FiveMPendingAction_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

