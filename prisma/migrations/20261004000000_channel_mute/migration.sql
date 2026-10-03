-- CreateTable
CREATE TABLE `ChannelMute` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `guildId` VARCHAR(32) NOT NULL,
    `channelId` VARCHAR(32) NOT NULL,
    `moderatorId` VARCHAR(32) NOT NULL,
    `reason` TEXT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ChannelMute_channelId_key`(`channelId`),
    INDEX `ChannelMute_expiresAt_idx`(`expiresAt`),
    INDEX `ChannelMute_guildId_idx`(`guildId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

