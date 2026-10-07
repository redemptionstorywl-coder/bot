-- Serveur de logs central (/template logs) : catégorie de logs GAME (logs en jeu), hubs, sources, serveurs de jeu et routes.

-- AlterTable
ALTER TABLE `LogChannel` MODIFY `category` ENUM('MESSAGE', 'MEMBER', 'ROLE', 'CHANNEL', 'VOICE', 'MODERATION', 'TICKET', 'WHITELIST', 'ANNOUNCEMENT', 'SHOP', 'BATTLE_ROYALE', 'SCHOOL', 'SECURITY', 'SYSTEM', 'GAME') NOT NULL;

-- AlterTable
ALTER TABLE `Log` MODIFY `category` ENUM('MESSAGE', 'MEMBER', 'ROLE', 'CHANNEL', 'VOICE', 'MODERATION', 'TICKET', 'WHITELIST', 'ANNOUNCEMENT', 'SHOP', 'BATTLE_ROYALE', 'SCHOOL', 'SECURITY', 'SYSTEM', 'GAME') NOT NULL;

-- CreateTable
CREATE TABLE `LogHub` (
    `guildId` VARCHAR(32) NOT NULL,
    `summaryMessageId` VARCHAR(32) NULL,
    `createdById` VARCHAR(32) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`guildId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LogHubSource` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `hubGuildId` VARCHAR(32) NOT NULL,
    `sourceGuildId` VARCHAR(32) NOT NULL,
    `label` VARCHAR(64) NOT NULL,
    `emoji` VARCHAR(16) NOT NULL DEFAULT '📁',
    `linkedById` VARCHAR(32) NOT NULL,
    `keepLocal` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LogHubSource_hubGuildId_idx`(`hubGuildId`),
    UNIQUE INDEX `LogHubSource_sourceGuildId_hubGuildId_key`(`sourceGuildId`, `hubGuildId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LogHubGame` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `hubGuildId` VARCHAR(32) NOT NULL,
    `fivemServerId` INTEGER NOT NULL,
    `chat` BOOLEAN NOT NULL DEFAULT false,
    `linkedById` VARCHAR(32) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `LogHubGame_hubGuildId_idx`(`hubGuildId`),
    UNIQUE INDEX `LogHubGame_fivemServerId_hubGuildId_key`(`fivemServerId`, `hubGuildId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LogRoute` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `hubGuildId` VARCHAR(32) NOT NULL,
    `sourceKey` VARCHAR(48) NOT NULL,
    `routeKey` VARCHAR(48) NOT NULL,
    `channelId` VARCHAR(32) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `LogRoute_hubGuildId_sourceKey_routeKey_key`(`hubGuildId`, `sourceKey`, `routeKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
