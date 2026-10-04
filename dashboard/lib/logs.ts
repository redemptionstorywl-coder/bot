/** Présentation des logs (catégories, icônes, libellés lisibles des actions). */

export const LOG_CATEGORY_META: Record<string, { label: string; icon: string; description: string }> = {
  MESSAGE: { label: 'Messages', icon: 'message-square', description: 'Messages modifiés, supprimés, suppressions en masse.' },
  MEMBER: { label: 'Membres', icon: 'user', description: 'Arrivées, départs, pseudos et rôles des membres.' },
  ROLE: { label: 'Rôles', icon: 'tags', description: 'Création, modification et suppression de rôles.' },
  CHANNEL: { label: 'Salons', icon: 'hash', description: 'Création, modification et suppression de salons.' },
  VOICE: { label: 'Vocal', icon: 'volume', description: 'Connexions et déplacements en vocal.' },
  MODERATION: { label: 'Modération', icon: 'shield', description: 'Sanctions, avertissements et actions du staff.' },
  TICKET: { label: 'Tickets', icon: 'ticket', description: 'Ouverture, prise en charge, fermeture et transcripts.' },
  WHITELIST: { label: 'Whitelist', icon: 'clipboard-check', description: 'Candidatures et décisions whitelist.' },
  ANNOUNCEMENT: { label: 'Annonces', icon: 'megaphone', description: 'Publication et programmation des annonces.' },
  SHOP: { label: 'Shop', icon: 'shopping-bag', description: 'Commandes, produits et webhooks Tebex.' },
  BATTLE_ROYALE: { label: 'Battle Royale', icon: 'swords', description: 'Saisons, XP et statistiques.' },
  SCHOOL: { label: 'School RP', icon: 'graduation-cap', description: 'Élèves, classes, maisons et clubs.' },
  SECURITY: { label: 'Sécurité', icon: 'shield-alert', description: 'Anti-raid, anti-nuke et salon piège.' },
  SYSTEM: { label: 'Système', icon: 'settings', description: 'Paramètres, modules et permissions modifiés.' },
};

const ACTION_LABELS: Record<string, string> = {
  'ticket.open': 'Ticket ouvert',
  'ticket.close': 'Ticket fermé',
  'ticket.claim': 'Ticket pris en charge',
  'ticket.reopen': 'Ticket réouvert',
  'ticket.delete': 'Ticket supprimé',
  'ticket.transfer': 'Ticket transféré',
  'ticket.member_add': 'Membre ajouté à un ticket',
  'ticket.member_remove': 'Membre retiré d’un ticket',
  'member.join': 'Arrivée d’un membre',
  'member.leave': 'Départ d’un membre',
  'member.roles': 'Rôles d’un membre modifiés',
  'member.nickname': 'Pseudo modifié',
  'message.edit': 'Message modifié',
  'message.delete': 'Message supprimé',
  'message.bulk_delete': 'Messages supprimés en masse',
  'channel.create': 'Salon créé',
  'channel.update': 'Salon modifié',
  'channel.delete': 'Salon supprimé',
  'role.create': 'Rôle créé',
  'role.update': 'Rôle modifié',
  'role.delete': 'Rôle supprimé',
  'voice.join': 'Connexion vocale',
  'invite.create': 'Invitation créée',
  'mod.ban': 'Bannissement',
  'mod.unban': 'Débannissement',
  'mod.kick': 'Expulsion',
  'mod.nuke_guild': 'Nettoyage du serveur',
  'settings.update': 'Paramètres mis à jour',
  'module.enable': 'Module activé',
  'module.disable': 'Module désactivé',
  'commands.permissions': 'Permissions des commandes modifiées',
  'honeypot.triggered': 'Salon piège déclenché',
  'honeypot.setup': 'Salon piège configuré',
  'antiraid.mass_join': 'Arrivées massives détectées',
  'announcement.schedule': 'Annonce programmée',
  'announcement.update': 'Annonce modifiée',
  'announcement.delete': 'Annonce supprimée',
  'announcement.archive': 'Annonce archivée',
  'giveaway.create': 'Giveaway lancé',
  'giveaway.end': 'Giveaway terminé',
  'event.create': 'Événement créé',
  'poll.create': 'Sondage créé',
  'whitelist.apply': 'Candidature whitelist',
  'fivem.link.manual': 'Joueur FiveM lié',
  'fivem.link.auto': 'Joueur FiveM lié automatiquement',
  'shop.order.create': 'Commande créée',
  'shop.order.status': 'Statut de commande modifié',
};

export interface LogLike {
  action: string;
  category: string;
  data: unknown;
}

/** Titre lisible d'un log : `data.title` si présent, sinon libellé de l'action, sinon code brut. */
export function logTitle(log: LogLike): string {
  const data = log.data && typeof log.data === 'object' ? (log.data as Record<string, unknown>) : null;
  if (data && typeof data.title === 'string' && data.title.trim()) return data.title.trim();
  return ACTION_LABELS[log.action] ?? log.action;
}

export function logIcon(category: string): string {
  return LOG_CATEGORY_META[category]?.icon ?? 'circle-dot';
}

export function logCategoryLabel(category: string): string {
  return LOG_CATEGORY_META[category]?.label ?? category;
}
