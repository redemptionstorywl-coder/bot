-- Fermeture des tickets sans suppression : le salon est conservé, déplacé dans la catégorie « Tickets fermés »
-- (TicketSettings.closedCategoryId) et un message de contrôle (📄 Transcript · 🔓 Rouvrir · 🗑️ Supprimer) est posté.
-- Titre saisi à l'ouverture. Suppression du « claim » (bouton Prendre en charge).

-- Données : les tickets « pris en charge » redeviennent simplement ouverts (le statut CLAIMED disparaît)
UPDATE `Ticket` SET `status` = 'OPEN' WHERE `status` = 'CLAIMED';

-- Données : relances « staff qui a pris le ticket » → rôles staff
UPDATE `TicketSettings` SET `reminderPing` = 'staff' WHERE `reminderPing` = 'claimer';

-- AlterTable
ALTER TABLE `Ticket` DROP COLUMN `claimedById`,
    ADD COLUMN `closeMessageId` VARCHAR(32) NULL,
    ADD COLUMN `openCategoryId` VARCHAR(32) NULL,
    ADD COLUMN `title` VARCHAR(100) NULL,
    ADD COLUMN `transcriptSentAt` DATETIME(3) NULL,
    MODIFY `status` ENUM('OPEN', 'CLOSED', 'ARCHIVED', 'DELETED') NOT NULL DEFAULT 'OPEN';

-- AlterTable
ALTER TABLE `TicketSettings` ADD COLUMN `closedCategoryId` VARCHAR(32) NULL,
    MODIFY `reminderPing` VARCHAR(16) NOT NULL DEFAULT 'staff';
