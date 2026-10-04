-- AlterTable
ALTER TABLE `Ticket` ADD COLUMN `lastMemberMessageAt` DATETIME(3) NULL,
    ADD COLUMN `lastReminderAt` DATETIME(3) NULL,
    ADD COLUMN `lastStaffReplyAt` DATETIME(3) NULL,
    ADD COLUMN `remindersMuted` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `TicketSettings` (
    `guildId` VARCHAR(32) NOT NULL,
    `remindersEnabled` BOOLEAN NOT NULL DEFAULT true,
    `reminderHours` INTEGER NOT NULL DEFAULT 24,
    `reminderPing` VARCHAR(16) NOT NULL DEFAULT 'claimer',
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`guildId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

