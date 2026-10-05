-- CreateTable
CREATE TABLE `AutoTranslateSettings` (
    `guildId` VARCHAR(32) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `layout` VARCHAR(16) NOT NULL DEFAULT 'embed',
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`guildId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AutoTranslateOverride` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `guildId` VARCHAR(32) NOT NULL,
    `scope` VARCHAR(32) NOT NULL,
    `targetId` VARCHAR(64) NOT NULL,
    `enabled` BOOLEAN NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `AutoTranslateOverride_guildId_scope_targetId_key`(`guildId`, `scope`, `targetId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TranslationCache` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `hash` VARCHAR(64) NOT NULL,
    `targetLang` VARCHAR(8) NOT NULL,
    `sourceLang` VARCHAR(8) NULL,
    `translatedText` TEXT NOT NULL,
    `provider` VARCHAR(32) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TranslationCache_createdAt_idx`(`createdAt`),
    UNIQUE INDEX `TranslationCache_hash_targetLang_key`(`hash`, `targetLang`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

