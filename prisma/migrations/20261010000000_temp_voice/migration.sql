-- CreateTable
CREATE TABLE `TempVoiceConfig` (
    `guildId` VARCHAR(32) NOT NULL,
    `lobbyIds` JSON NOT NULL,
    `categoryId` VARCHAR(32) NULL,
    `userLimit` INTEGER NULL,
    `rules` JSON NOT NULL,
    `fallback` JSON NULL,
    `ownerPermissions` BOOLEAN NOT NULL DEFAULT true,
    `transferOwnership` BOOLEAN NOT NULL DEFAULT true,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`guildId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TempVoiceChannel` (
    `channelId` VARCHAR(32) NOT NULL,
    `guildId` VARCHAR(32) NOT NULL,
    `ownerId` VARCHAR(32) NOT NULL,
    `lobbyId` VARCHAR(32) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TempVoiceChannel_guildId_idx`(`guildId`),
    INDEX `TempVoiceChannel_guildId_ownerId_idx`(`guildId`, `ownerId`),
    PRIMARY KEY (`channelId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

