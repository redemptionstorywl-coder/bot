-- CreateTable
CREATE TABLE `Guild` (
    `id` VARCHAR(32) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `icon` VARCHAR(191) NULL,
    `kind` ENUM('GENERIC', 'PRISON', 'BATTLE_ROYALE', 'SCHOOL', 'SHOP') NOT NULL DEFAULT 'GENERIC',
    `ownerId` VARCHAR(32) NULL,
    `joinedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `leftAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GuildSettings` (
    `guildId` VARCHAR(32) NOT NULL,
    `defaultLanguage` VARCHAR(8) NOT NULL DEFAULT 'fr',
    `timezone` VARCHAR(191) NOT NULL DEFAULT 'Europe/Paris',
    `brandColor` VARCHAR(9) NOT NULL DEFAULT '#7C3AED',
    `adminRoleIds` JSON NOT NULL,
    `staffRoleIds` JSON NOT NULL,
    `modules` JSON NOT NULL,
    `translationMode` ENUM('CHANNELS', 'PERMISSIONS') NOT NULL DEFAULT 'CHANNELS',
    `languageChannels` JSON NOT NULL,
    `enabledLanguages` JSON NOT NULL,
    `languagePanelChannelId` VARCHAR(32) NULL,
    `languagePanelMessageId` VARCHAR(32) NULL,
    `displayName` VARCHAR(191) NULL,
    `footerText` VARCHAR(191) NULL,
    `footerIconUrl` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`guildId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LogChannel` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `guildId` VARCHAR(32) NOT NULL,
    `category` ENUM('MESSAGE', 'MEMBER', 'ROLE', 'CHANNEL', 'VOICE', 'MODERATION', 'TICKET', 'WHITELIST', 'ANNOUNCEMENT', 'SHOP', 'BATTLE_ROYALE', 'SCHOOL', 'SECURITY', 'SYSTEM') NOT NULL,
    `channelId` VARCHAR(32) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `LogChannel_guildId_category_key`(`guildId`, `category`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CommandPermission` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `guildId` VARCHAR(32) NOT NULL,
    `commandName` VARCHAR(64) NOT NULL,
    `roleIds` JSON NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `CommandPermission_guildId_commandName_key`(`guildId`, `commandName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(32) NOT NULL,
    `username` VARCHAR(191) NOT NULL,
    `globalName` VARCHAR(191) NULL,
    `avatar` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `UserLanguage` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` VARCHAR(32) NOT NULL,
    `guildId` VARCHAR(32) NOT NULL,
    `language` VARCHAR(8) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `UserLanguage_guildId_language_idx`(`guildId`, `language`),
    UNIQUE INDEX `UserLanguage_userId_guildId_key`(`userId`, `guildId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LanguageRole` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `guildId` VARCHAR(32) NOT NULL,
    `language` VARCHAR(8) NOT NULL,
    `roleId` VARCHAR(32) NOT NULL,
    `emoji` VARCHAR(191) NULL,
    `label` VARCHAR(191) NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `LanguageRole_guildId_language_key`(`guildId`, `language`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Translation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `guildId` VARCHAR(32) NULL,
    `language` VARCHAR(8) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `value` TEXT NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Translation_guildId_language_key_key`(`guildId`, `language`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TicketCounter` (
    `guildId` VARCHAR(32) NOT NULL,
    `value` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`guildId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TicketType` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `guildId` VARCHAR(32) NOT NULL,
    `key` VARCHAR(64) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `emoji` VARCHAR(191) NULL,
    `description` VARCHAR(191) NULL,
    `categoryId` VARCHAR(32) NULL,
    `archiveCategoryId` VARCHAR(32) NULL,
    `staffRoleIds` JSON NOT NULL,
    `questions` JSON NOT NULL,
    `embed` JSON NULL,
    `welcomeMessage` TEXT NULL,
    `language` VARCHAR(8) NULL,
    `nameFormat` VARCHAR(191) NOT NULL DEFAULT 'ticket-{number}',
    `maxPerUser` INTEGER NOT NULL DEFAULT 1,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `order` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `TicketType_guildId_key_key`(`guildId`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TicketPanel` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `guildId` VARCHAR(32) NOT NULL,
    `channelId` VARCHAR(32) NOT NULL,
    `messageId` VARCHAR(32) NULL,
    `embed` JSON NOT NULL,
    `typeIds` JSON NOT NULL,
    `style` ENUM('BUTTONS', 'SELECT') NOT NULL DEFAULT 'BUTTONS',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Ticket` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `guildId` VARCHAR(32) NOT NULL,
    `number` INTEGER NOT NULL,
    `channelId` VARCHAR(32) NOT NULL,
    `typeId` INTEGER NULL,
    `userId` VARCHAR(32) NOT NULL,
    `status` ENUM('OPEN', 'CLAIMED', 'CLOSED', 'ARCHIVED', 'DELETED') NOT NULL DEFAULT 'OPEN',
    `claimedById` VARCHAR(32) NULL,
    `closedById` VARCHAR(32) NULL,
    `closeReason` TEXT NULL,
    `closedAt` DATETIME(3) NULL,
    `formAnswers` JSON NOT NULL,
    `participants` JSON NOT NULL,
    `language` VARCHAR(8) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Ticket_guildId_userId_status_idx`(`guildId`, `userId`, `status`),
    INDEX `Ticket_channelId_idx`(`channelId`),
    UNIQUE INDEX `Ticket_guildId_number_key`(`guildId`, `number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TicketMessage` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ticketId` INTEGER NOT NULL,
    `messageId` VARCHAR(32) NOT NULL,
    `authorId` VARCHAR(32) NOT NULL,
    `authorTag` VARCHAR(191) NOT NULL,
    `authorAvatar` VARCHAR(191) NULL,
    `content` TEXT NOT NULL,
    `attachments` JSON NOT NULL,
    `embeds` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TicketMessage_ticketId_idx`(`ticketId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TicketTranscript` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ticketId` INTEGER NOT NULL,
    `htmlPath` VARCHAR(191) NULL,
    `txtPath` VARCHAR(191) NULL,
    `pdfPath` VARCHAR(191) NULL,
    `messageCount` INTEGER NOT NULL DEFAULT 0,
    `durationSeconds` INTEGER NOT NULL DEFAULT 0,
    `staffIds` JSON NOT NULL,
    `closeReason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `TicketTranscript_ticketId_key`(`ticketId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ModerationConfig` (
    `guildId` VARCHAR(32) NOT NULL,
    `warnThresholds` JSON NOT NULL,
    `muteRoleId` VARCHAR(32) NULL,
    `dmOnSanction` BOOLEAN NOT NULL DEFAULT true,
    `antiRaid` JSON NOT NULL,
    `lockdownActive` BOOLEAN NOT NULL DEFAULT false,
    `lockdownState` JSON NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`guildId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Sanction` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `guildId` VARCHAR(32) NOT NULL,
    `caseNumber` INTEGER NOT NULL,
    `type` ENUM('BAN', 'TEMPBAN', 'UNBAN', 'KICK', 'WARN', 'UNWARN', 'TIMEOUT', 'UNTIMEOUT', 'MUTE', 'UNMUTE', 'PURGE', 'LOCK', 'UNLOCK', 'SLOWMODE', 'LOCKDOWN', 'LOCKDOWN_END') NOT NULL,
    `userId` VARCHAR(32) NULL,
    `moderatorId` VARCHAR(32) NOT NULL,
    `reason` TEXT NULL,
    `duration` INTEGER NULL,
    `channelId` VARCHAR(32) NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Sanction_guildId_userId_idx`(`guildId`, `userId`),
    UNIQUE INDEX `Sanction_guildId_caseNumber_key`(`guildId`, `caseNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Warning` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `guildId` VARCHAR(32) NOT NULL,
    `userId` VARCHAR(32) NOT NULL,
    `moderatorId` VARCHAR(32) NOT NULL,
    `reason` TEXT NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Warning_guildId_userId_active_idx`(`guildId`, `userId`, `active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Ban` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `guildId` VARCHAR(32) NOT NULL,
    `userId` VARCHAR(32) NOT NULL,
    `moderatorId` VARCHAR(32) NOT NULL,
    `reason` TEXT NULL,
    `expiresAt` DATETIME(3) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Ban_guildId_userId_active_idx`(`guildId`, `userId`, `active`),
    INDEX `Ban_active_expiresAt_idx`(`active`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Mute` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `guildId` VARCHAR(32) NOT NULL,
    `userId` VARCHAR(32) NOT NULL,
    `moderatorId` VARCHAR(32) NOT NULL,
    `reason` TEXT NULL,
    `expiresAt` DATETIME(3) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Mute_guildId_userId_active_idx`(`guildId`, `userId`, `active`),
    INDEX `Mute_active_expiresAt_idx`(`active`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AutoRole` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `guildId` VARCHAR(32) NOT NULL,
    `roleId` VARCHAR(32) NOT NULL,
    `type` ENUM('JOIN', 'BOT', 'VERIFIED', 'MEMBER', 'LANGUAGE', 'SPECIAL') NOT NULL DEFAULT 'JOIN',
    `delaySeconds` INTEGER NOT NULL DEFAULT 0,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `AutoRole_guildId_roleId_type_key`(`guildId`, `roleId`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RoleMenu` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `guildId` VARCHAR(32) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `channelId` VARCHAR(32) NULL,
    `messageId` VARCHAR(32) NULL,
    `style` ENUM('BUTTONS', 'SELECT') NOT NULL DEFAULT 'BUTTONS',
    `embed` JSON NOT NULL,
    `options` JSON NOT NULL,
    `minValues` INTEGER NOT NULL DEFAULT 0,
    `maxValues` INTEGER NOT NULL DEFAULT 25,
    `exclusive` BOOLEAN NOT NULL DEFAULT false,
    `placeholder` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `RoleMenu_messageId_idx`(`messageId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReactionRole` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `guildId` VARCHAR(32) NOT NULL,
    `channelId` VARCHAR(32) NOT NULL,
    `messageId` VARCHAR(32) NOT NULL,
    `emoji` VARCHAR(128) NOT NULL,
    `roleId` VARCHAR(32) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ReactionRole_guildId_idx`(`guildId`),
    UNIQUE INDEX `ReactionRole_messageId_emoji_key`(`messageId`, `emoji`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `NotificationRole` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `guildId` VARCHAR(32) NOT NULL,
    `key` VARCHAR(64) NOT NULL,
    `roleId` VARCHAR(32) NOT NULL,
    `label` VARCHAR(191) NOT NULL,
    `emoji` VARCHAR(191) NULL,
    `description` VARCHAR(191) NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `order` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `NotificationRole_guildId_key_key`(`guildId`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WelcomeConfig` (
    `guildId` VARCHAR(32) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `channelId` VARCHAR(32) NULL,
    `message` JSON NULL,
    `embed` JSON NULL,
    `imageEnabled` BOOLEAN NOT NULL DEFAULT false,
    `imageBackgroundUrl` VARCHAR(191) NULL,
    `imageTitle` VARCHAR(191) NOT NULL DEFAULT 'BIENVENUE',
    `imageSubtitle` VARCHAR(191) NOT NULL DEFAULT '{username} · membre #{memberCount}',
    `dmEnabled` BOOLEAN NOT NULL DEFAULT false,
    `dmMessage` JSON NULL,
    `dmEmbed` JSON NULL,
    `buttons` JSON NOT NULL,
    `languagePromptEnabled` BOOLEAN NOT NULL DEFAULT false,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`guildId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LeaveConfig` (
    `guildId` VARCHAR(32) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `channelId` VARCHAR(32) NULL,
    `message` JSON NULL,
    `embed` JSON NULL,
    `imageEnabled` BOOLEAN NOT NULL DEFAULT false,
    `imageBackgroundUrl` VARCHAR(191) NULL,
    `logEnabled` BOOLEAN NOT NULL DEFAULT true,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`guildId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EmbedTemplate` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `guildId` VARCHAR(32) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `description` VARCHAR(191) NULL,
    `spec` JSON NOT NULL,
    `buttons` JSON NOT NULL,
    `createdById` VARCHAR(32) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `EmbedTemplate_guildId_name_key`(`guildId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Announcement` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `guildId` VARCHAR(32) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `content` TEXT NULL,
    `spec` JSON NOT NULL,
    `translations` JSON NOT NULL,
    `sourceLanguage` VARCHAR(8) NOT NULL DEFAULT 'fr',
    `targetLanguages` JSON NOT NULL,
    `channelId` VARCHAR(32) NULL,
    `mentionRoleIds` JSON NOT NULL,
    `mentionEveryone` BOOLEAN NOT NULL DEFAULT false,
    `buttons` JSON NOT NULL,
    `status` ENUM('DRAFT', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    `messages` JSON NOT NULL,
    `createdById` VARCHAR(32) NOT NULL,
    `publishedAt` DATETIME(3) NULL,
    `archivedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Announcement_guildId_status_idx`(`guildId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ScheduledAnnouncement` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `announcementId` INTEGER NOT NULL,
    `scheduledAt` DATETIME(3) NOT NULL,
    `status` ENUM('PENDING', 'SENT', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `error` TEXT NULL,
    `sentAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ScheduledAnnouncement_status_scheduledAt_idx`(`status`, `scheduledAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Event` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `guildId` VARCHAR(32) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NOT NULL,
    `startsAt` DATETIME(3) NOT NULL,
    `endsAt` DATETIME(3) NULL,
    `location` VARCHAR(191) NULL,
    `imageUrl` VARCHAR(191) NULL,
    `mentionRoleId` VARCHAR(32) NULL,
    `maxParticipants` INTEGER NULL,
    `channelId` VARCHAR(32) NOT NULL,
    `messageId` VARCHAR(32) NULL,
    `language` VARCHAR(8) NULL,
    `status` ENUM('SCHEDULED', 'ONGOING', 'ENDED', 'CANCELLED') NOT NULL DEFAULT 'SCHEDULED',
    `remindersSent` JSON NOT NULL,
    `reminderOffsets` JSON NOT NULL,
    `createdById` VARCHAR(32) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Event_status_startsAt_idx`(`status`, `startsAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EventParticipant` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `eventId` INTEGER NOT NULL,
    `userId` VARCHAR(32) NOT NULL,
    `joinedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `EventParticipant_eventId_userId_key`(`eventId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Giveaway` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `guildId` VARCHAR(32) NOT NULL,
    `channelId` VARCHAR(32) NOT NULL,
    `messageId` VARCHAR(32) NULL,
    `prize` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `winnersCount` INTEGER NOT NULL DEFAULT 1,
    `endsAt` DATETIME(3) NOT NULL,
    `requiredRoleId` VARCHAR(32) NULL,
    `minMessages` INTEGER NOT NULL DEFAULT 0,
    `language` VARCHAR(8) NULL,
    `hostId` VARCHAR(32) NOT NULL,
    `ended` BOOLEAN NOT NULL DEFAULT false,
    `winners` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Giveaway_ended_endsAt_idx`(`ended`, `endsAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GiveawayEntry` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `giveawayId` INTEGER NOT NULL,
    `userId` VARCHAR(32) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `GiveawayEntry_giveawayId_userId_key`(`giveawayId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Poll` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `guildId` VARCHAR(32) NOT NULL,
    `channelId` VARCHAR(32) NOT NULL,
    `messageId` VARCHAR(32) NULL,
    `question` TEXT NOT NULL,
    `options` JSON NOT NULL,
    `type` ENUM('YES_NO', 'MULTIPLE') NOT NULL DEFAULT 'MULTIPLE',
    `anonymous` BOOLEAN NOT NULL DEFAULT false,
    `multiSelect` BOOLEAN NOT NULL DEFAULT false,
    `endsAt` DATETIME(3) NULL,
    `ended` BOOLEAN NOT NULL DEFAULT false,
    `results` JSON NULL,
    `createdById` VARCHAR(32) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Poll_ended_endsAt_idx`(`ended`, `endsAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PollVote` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `pollId` INTEGER NOT NULL,
    `userId` VARCHAR(32) NOT NULL,
    `optionIndex` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PollVote_pollId_userId_optionIndex_key`(`pollId`, `userId`, `optionIndex`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Log` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `guildId` VARCHAR(32) NOT NULL,
    `category` ENUM('MESSAGE', 'MEMBER', 'ROLE', 'CHANNEL', 'VOICE', 'MODERATION', 'TICKET', 'WHITELIST', 'ANNOUNCEMENT', 'SHOP', 'BATTLE_ROYALE', 'SCHOOL', 'SECURITY', 'SYSTEM') NOT NULL,
    `action` VARCHAR(64) NOT NULL,
    `actorId` VARCHAR(32) NULL,
    `targetId` VARCHAR(32) NULL,
    `data` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Log_guildId_category_createdAt_idx`(`guildId`, `category`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MessageActivity` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `guildId` VARCHAR(32) NOT NULL,
    `userId` VARCHAR(32) NOT NULL,
    `count` INTEGER NOT NULL DEFAULT 0,
    `lastAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `MessageActivity_guildId_userId_key`(`guildId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BattleRoyaleProfile` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `guildId` VARCHAR(32) NOT NULL,
    `userId` VARCHAR(32) NOT NULL,
    `nickname` VARCHAR(191) NULL,
    `identifier` VARCHAR(128) NULL,
    `level` INTEGER NOT NULL DEFAULT 1,
    `xp` INTEGER NOT NULL DEFAULT 0,
    `playtimeMinutes` INTEGER NOT NULL DEFAULT 0,
    `battlePassTier` INTEGER NOT NULL DEFAULT 0,
    `battlePassXp` INTEGER NOT NULL DEFAULT 0,
    `battlePassPremium` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `BattleRoyaleProfile_guildId_identifier_idx`(`guildId`, `identifier`),
    UNIQUE INDEX `BattleRoyaleProfile_guildId_userId_key`(`guildId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BattleRoyaleStats` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `profileId` INTEGER NOT NULL,
    `season` INTEGER NOT NULL DEFAULT 1,
    `wins` INTEGER NOT NULL DEFAULT 0,
    `kills` INTEGER NOT NULL DEFAULT 0,
    `deaths` INTEGER NOT NULL DEFAULT 0,
    `matches` INTEGER NOT NULL DEFAULT 0,
    `damage` INTEGER NOT NULL DEFAULT 0,
    `top10` INTEGER NOT NULL DEFAULT 0,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `BattleRoyaleStats_season_wins_idx`(`season`, `wins`),
    INDEX `BattleRoyaleStats_season_kills_idx`(`season`, `kills`),
    UNIQUE INDEX `BattleRoyaleStats_profileId_season_key`(`profileId`, `season`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BattlePass` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `guildId` VARCHAR(32) NOT NULL,
    `season` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `startsAt` DATETIME(3) NOT NULL,
    `endsAt` DATETIME(3) NOT NULL,
    `tiers` JSON NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `BattlePass_guildId_season_key`(`guildId`, `season`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FiveMServer` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `guildId` VARCHAR(32) NOT NULL,
    `key` VARCHAR(64) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `framework` ENUM('ESX', 'QBCORE', 'CUSTOM') NOT NULL DEFAULT 'CUSTOM',
    `host` VARCHAR(191) NULL,
    `apiKey` VARCHAR(191) NULL,
    `statusChannelId` VARCHAR(32) NULL,
    `statusMessageId` VARCHAR(32) NULL,
    `lastStatus` JSON NULL,
    `lastSeenAt` DATETIME(3) NULL,
    `maintenance` BOOLEAN NOT NULL DEFAULT false,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `FiveMServer_guildId_key_key`(`guildId`, `key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Whitelist` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `guildId` VARCHAR(32) NOT NULL,
    `userId` VARCHAR(32) NOT NULL,
    `identifier` VARCHAR(128) NULL,
    `status` ENUM('PENDING', 'ACCEPTED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `answers` JSON NOT NULL,
    `reviewedById` VARCHAR(32) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Whitelist_guildId_userId_idx`(`guildId`, `userId`),
    INDEX `Whitelist_guildId_status_idx`(`guildId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ShopCategory` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `guildId` VARCHAR(32) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `emoji` VARCHAR(191) NULL,
    `order` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ShopProduct` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `guildId` VARCHAR(32) NOT NULL,
    `categoryId` INTEGER NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `price` DECIMAL(10, 2) NOT NULL,
    `currency` VARCHAR(8) NOT NULL DEFAULT 'EUR',
    `imageUrl` VARCHAR(191) NULL,
    `tebexPackageId` VARCHAR(191) NULL,
    `tebexUrl` VARCHAR(191) NULL,
    `stock` INTEGER NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ShopOrder` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `guildId` VARCHAR(32) NOT NULL,
    `userId` VARCHAR(32) NOT NULL,
    `productId` INTEGER NULL,
    `quantity` INTEGER NOT NULL DEFAULT 1,
    `total` DECIMAL(10, 2) NOT NULL,
    `currency` VARCHAR(8) NOT NULL DEFAULT 'EUR',
    `status` ENUM('PENDING', 'PAID', 'DELIVERED', 'CANCELLED', 'REFUNDED') NOT NULL DEFAULT 'PENDING',
    `tebexTransactionId` VARCHAR(191) NULL,
    `ticketId` INTEGER NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `ShopOrder_guildId_userId_idx`(`guildId`, `userId`),
    INDEX `ShopOrder_guildId_status_idx`(`guildId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SchoolProfile` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `guildId` VARCHAR(32) NOT NULL,
    `userId` VARCHAR(32) NOT NULL,
    `role` ENUM('STUDENT', 'TEACHER', 'STAFF') NOT NULL DEFAULT 'STUDENT',
    `firstName` VARCHAR(191) NOT NULL,
    `lastName` VARCHAR(191) NOT NULL,
    `classId` INTEGER NULL,
    `houseId` INTEGER NULL,
    `points` INTEGER NOT NULL DEFAULT 0,
    `bio` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `SchoolProfile_guildId_userId_key`(`guildId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SchoolClass` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `guildId` VARCHAR(32) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `teacherId` VARCHAR(32) NULL,
    `roleId` VARCHAR(32) NULL,
    `channelId` VARCHAR(32) NULL,
    `capacity` INTEGER NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SchoolHouse` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `guildId` VARCHAR(32) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `emoji` VARCHAR(191) NULL,
    `color` VARCHAR(9) NULL,
    `roleId` VARCHAR(32) NULL,
    `points` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SchoolClub` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `guildId` VARCHAR(32) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `leaderId` VARCHAR(32) NULL,
    `roleId` VARCHAR(32) NULL,
    `maxMembers` INTEGER NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SchoolClubMember` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `clubId` INTEGER NOT NULL,
    `profileId` INTEGER NOT NULL,
    `joinedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `SchoolClubMember_clubId_profileId_key`(`clubId`, `profileId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SchoolApplication` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `guildId` VARCHAR(32) NOT NULL,
    `userId` VARCHAR(32) NOT NULL,
    `role` ENUM('STUDENT', 'TEACHER', 'STAFF') NOT NULL DEFAULT 'STUDENT',
    `answers` JSON NOT NULL,
    `status` ENUM('PENDING', 'ACCEPTED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `reviewedById` VARCHAR(32) NULL,
    `reviewedAt` DATETIME(3) NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SchoolApplication_guildId_status_idx`(`guildId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DashboardSession` (
    `sid` VARCHAR(128) NOT NULL,
    `data` JSON NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,

    INDEX `DashboardSession_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`sid`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WhitelistConfig` (
    `guildId` VARCHAR(32) NOT NULL,
    `questions` JSON NOT NULL,
    `reviewChannelId` VARCHAR(32) NULL,
    `acceptedRoleId` VARCHAR(32) NULL,
    `pendingRoleId` VARCHAR(32) NULL,
    `dmOnDecision` BOOLEAN NOT NULL DEFAULT true,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`guildId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SchoolConfig` (
    `guildId` VARCHAR(32) NOT NULL,
    `applicationChannelId` VARCHAR(32) NULL,
    `announceChannelId` VARCHAR(32) NULL,
    `studentRoleId` VARCHAR(32) NULL,
    `teacherRoleId` VARCHAR(32) NULL,
    `staffRoleId` VARCHAR(32) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`guildId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `GuildSettings` ADD CONSTRAINT `GuildSettings_guildId_fkey` FOREIGN KEY (`guildId`) REFERENCES `Guild`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LogChannel` ADD CONSTRAINT `LogChannel_guildId_fkey` FOREIGN KEY (`guildId`) REFERENCES `Guild`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CommandPermission` ADD CONSTRAINT `CommandPermission_guildId_fkey` FOREIGN KEY (`guildId`) REFERENCES `Guild`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserLanguage` ADD CONSTRAINT `UserLanguage_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `UserLanguage` ADD CONSTRAINT `UserLanguage_guildId_fkey` FOREIGN KEY (`guildId`) REFERENCES `Guild`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LanguageRole` ADD CONSTRAINT `LanguageRole_guildId_fkey` FOREIGN KEY (`guildId`) REFERENCES `Guild`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Translation` ADD CONSTRAINT `Translation_guildId_fkey` FOREIGN KEY (`guildId`) REFERENCES `Guild`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TicketCounter` ADD CONSTRAINT `TicketCounter_guildId_fkey` FOREIGN KEY (`guildId`) REFERENCES `Guild`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TicketType` ADD CONSTRAINT `TicketType_guildId_fkey` FOREIGN KEY (`guildId`) REFERENCES `Guild`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TicketPanel` ADD CONSTRAINT `TicketPanel_guildId_fkey` FOREIGN KEY (`guildId`) REFERENCES `Guild`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Ticket` ADD CONSTRAINT `Ticket_guildId_fkey` FOREIGN KEY (`guildId`) REFERENCES `Guild`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Ticket` ADD CONSTRAINT `Ticket_typeId_fkey` FOREIGN KEY (`typeId`) REFERENCES `TicketType`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TicketMessage` ADD CONSTRAINT `TicketMessage_ticketId_fkey` FOREIGN KEY (`ticketId`) REFERENCES `Ticket`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TicketTranscript` ADD CONSTRAINT `TicketTranscript_ticketId_fkey` FOREIGN KEY (`ticketId`) REFERENCES `Ticket`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ModerationConfig` ADD CONSTRAINT `ModerationConfig_guildId_fkey` FOREIGN KEY (`guildId`) REFERENCES `Guild`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Sanction` ADD CONSTRAINT `Sanction_guildId_fkey` FOREIGN KEY (`guildId`) REFERENCES `Guild`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Warning` ADD CONSTRAINT `Warning_guildId_fkey` FOREIGN KEY (`guildId`) REFERENCES `Guild`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Ban` ADD CONSTRAINT `Ban_guildId_fkey` FOREIGN KEY (`guildId`) REFERENCES `Guild`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Mute` ADD CONSTRAINT `Mute_guildId_fkey` FOREIGN KEY (`guildId`) REFERENCES `Guild`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AutoRole` ADD CONSTRAINT `AutoRole_guildId_fkey` FOREIGN KEY (`guildId`) REFERENCES `Guild`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RoleMenu` ADD CONSTRAINT `RoleMenu_guildId_fkey` FOREIGN KEY (`guildId`) REFERENCES `Guild`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReactionRole` ADD CONSTRAINT `ReactionRole_guildId_fkey` FOREIGN KEY (`guildId`) REFERENCES `Guild`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `NotificationRole` ADD CONSTRAINT `NotificationRole_guildId_fkey` FOREIGN KEY (`guildId`) REFERENCES `Guild`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WelcomeConfig` ADD CONSTRAINT `WelcomeConfig_guildId_fkey` FOREIGN KEY (`guildId`) REFERENCES `Guild`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LeaveConfig` ADD CONSTRAINT `LeaveConfig_guildId_fkey` FOREIGN KEY (`guildId`) REFERENCES `Guild`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmbedTemplate` ADD CONSTRAINT `EmbedTemplate_guildId_fkey` FOREIGN KEY (`guildId`) REFERENCES `Guild`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Announcement` ADD CONSTRAINT `Announcement_guildId_fkey` FOREIGN KEY (`guildId`) REFERENCES `Guild`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ScheduledAnnouncement` ADD CONSTRAINT `ScheduledAnnouncement_announcementId_fkey` FOREIGN KEY (`announcementId`) REFERENCES `Announcement`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Event` ADD CONSTRAINT `Event_guildId_fkey` FOREIGN KEY (`guildId`) REFERENCES `Guild`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EventParticipant` ADD CONSTRAINT `EventParticipant_eventId_fkey` FOREIGN KEY (`eventId`) REFERENCES `Event`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Giveaway` ADD CONSTRAINT `Giveaway_guildId_fkey` FOREIGN KEY (`guildId`) REFERENCES `Guild`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GiveawayEntry` ADD CONSTRAINT `GiveawayEntry_giveawayId_fkey` FOREIGN KEY (`giveawayId`) REFERENCES `Giveaway`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Poll` ADD CONSTRAINT `Poll_guildId_fkey` FOREIGN KEY (`guildId`) REFERENCES `Guild`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PollVote` ADD CONSTRAINT `PollVote_pollId_fkey` FOREIGN KEY (`pollId`) REFERENCES `Poll`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Log` ADD CONSTRAINT `Log_guildId_fkey` FOREIGN KEY (`guildId`) REFERENCES `Guild`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MessageActivity` ADD CONSTRAINT `MessageActivity_guildId_fkey` FOREIGN KEY (`guildId`) REFERENCES `Guild`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BattleRoyaleProfile` ADD CONSTRAINT `BattleRoyaleProfile_guildId_fkey` FOREIGN KEY (`guildId`) REFERENCES `Guild`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BattleRoyaleStats` ADD CONSTRAINT `BattleRoyaleStats_profileId_fkey` FOREIGN KEY (`profileId`) REFERENCES `BattleRoyaleProfile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `BattlePass` ADD CONSTRAINT `BattlePass_guildId_fkey` FOREIGN KEY (`guildId`) REFERENCES `Guild`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FiveMServer` ADD CONSTRAINT `FiveMServer_guildId_fkey` FOREIGN KEY (`guildId`) REFERENCES `Guild`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Whitelist` ADD CONSTRAINT `Whitelist_guildId_fkey` FOREIGN KEY (`guildId`) REFERENCES `Guild`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ShopCategory` ADD CONSTRAINT `ShopCategory_guildId_fkey` FOREIGN KEY (`guildId`) REFERENCES `Guild`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ShopProduct` ADD CONSTRAINT `ShopProduct_guildId_fkey` FOREIGN KEY (`guildId`) REFERENCES `Guild`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ShopProduct` ADD CONSTRAINT `ShopProduct_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `ShopCategory`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ShopOrder` ADD CONSTRAINT `ShopOrder_guildId_fkey` FOREIGN KEY (`guildId`) REFERENCES `Guild`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ShopOrder` ADD CONSTRAINT `ShopOrder_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `ShopProduct`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SchoolProfile` ADD CONSTRAINT `SchoolProfile_guildId_fkey` FOREIGN KEY (`guildId`) REFERENCES `Guild`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SchoolProfile` ADD CONSTRAINT `SchoolProfile_classId_fkey` FOREIGN KEY (`classId`) REFERENCES `SchoolClass`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SchoolProfile` ADD CONSTRAINT `SchoolProfile_houseId_fkey` FOREIGN KEY (`houseId`) REFERENCES `SchoolHouse`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SchoolClass` ADD CONSTRAINT `SchoolClass_guildId_fkey` FOREIGN KEY (`guildId`) REFERENCES `Guild`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SchoolHouse` ADD CONSTRAINT `SchoolHouse_guildId_fkey` FOREIGN KEY (`guildId`) REFERENCES `Guild`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SchoolClub` ADD CONSTRAINT `SchoolClub_guildId_fkey` FOREIGN KEY (`guildId`) REFERENCES `Guild`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SchoolClubMember` ADD CONSTRAINT `SchoolClubMember_clubId_fkey` FOREIGN KEY (`clubId`) REFERENCES `SchoolClub`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SchoolClubMember` ADD CONSTRAINT `SchoolClubMember_profileId_fkey` FOREIGN KEY (`profileId`) REFERENCES `SchoolProfile`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SchoolApplication` ADD CONSTRAINT `SchoolApplication_guildId_fkey` FOREIGN KEY (`guildId`) REFERENCES `Guild`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

