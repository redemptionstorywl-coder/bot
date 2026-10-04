-- CreateTable
CREATE TABLE `HoneypotChannel` (
    `guildId` VARCHAR(32) NOT NULL,
    `channelId` VARCHAR(32) NOT NULL,
    `messageId` VARCHAR(32) NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `deleteWindowMinutes` INTEGER NOT NULL DEFAULT 60,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`guildId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

