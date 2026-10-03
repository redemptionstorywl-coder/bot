-- AlterTable
ALTER TABLE `GuildSettings` ADD COLUMN `autoTranslate` BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE `MachineTranslation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `hash` VARCHAR(64) NOT NULL,
    `sourceLang` VARCHAR(8) NOT NULL,
    `targetLang` VARCHAR(8) NOT NULL,
    `sourceText` TEXT NOT NULL,
    `translatedText` TEXT NOT NULL,
    `provider` VARCHAR(32) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `MachineTranslation_hash_sourceLang_targetLang_key`(`hash`, `sourceLang`, `targetLang`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

