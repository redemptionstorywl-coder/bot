import type { SanctionType } from '@prisma/client';
import type { RedemptionClient } from '../../src/core/Client';
import type { ResolvedGuildConfig } from '../../src/services/GuildConfigService';
import { prisma } from '../../src/database/client';
import { welcomeService } from '../../src/services/WelcomeService';
import { moderationService } from '../../src/services/ModerationService';
import { whitelistService } from '../../src/services/WhitelistService';
import { childLogger } from '../../src/utils/logger';
import { dayAxis, bucketByDay, mirrorChart, lineChart, hbarsChart, type MirrorChartModel, type LineChartModel, type HBarsModel } from './charts';
import type { GuildView } from './guildData';

const log = childLogger('Dashboard');

/** Exécute une lecture « non critique » : en cas d'erreur, valeur de repli (la vue d'ensemble ne tombe jamais en 500). */
async function soft<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    const v = await fn();
    return v === undefined || v === null ? fallback : v;
  } catch (err) {
    log.warn({ err, label }, 'Vue d’ensemble : donnée indisponible');
    return fallback;
  }
}

export interface SetupStep {
  key: string;
  title: string;
  desc: string;
  href: string;
  cta: string;
  done: boolean;
}

/**
 * Liste de mise en route, cochée d'après la configuration réelle du serveur.
 * Chaque étape mène à la page (ou la section) qui la règle.
 */
export async function buildSetupSteps(guild: GuildView, config: ResolvedGuildConfig, fivemServers: number): Promise<SetupStep[]> {
  const base = `/guilds/${guild.id}`;
  const m = config.modules;
  const [welcome, ticketTypes, ticketPanels, modConfig, whitelist, products] = await Promise.all([
    soft('welcome', () => welcomeService.getConfig(guild.id), null),
    soft('ticketTypes', () => prisma.ticketType.count({ where: { guildId: guild.id } }), 0),
    soft('ticketPanels', () => prisma.ticketPanel.count({ where: { guildId: guild.id } }), 0),
    soft('moderation', () => moderationService.getConfig(guild.id), null),
    m.whitelist ? soft('whitelist', () => whitelistService.getConfig(guild.id), null) : Promise.resolve(null),
    m.shop ? soft('products', () => prisma.shopProduct.count({ where: { guildId: guild.id } }), 0) : Promise.resolve(0),
  ]);
  const logCount = Object.values(config.logChannels ?? {}).filter(Boolean).length;
  const team = config.staffRoleIds.length + config.adminRoleIds.length;
  const ar = modConfig?.antiRaid;
  const protections = ar ? [ar.antiNuke?.enabled, ar.antiSpam?.enabled, ar.antiMassMention?.enabled, ar.antiLink?.enabled, ar.antiNewAccount?.enabled, ar.antiBot?.enabled, ar.antiMassJoin?.enabled].filter(Boolean).length : 0;

  const steps: SetupStep[] = [
    {
      key: 'logs',
      title: 'Choisir les salons de logs',
      desc: logCount ? `${logCount} catégorie(s) publiée(s) dans vos salons.` : 'Le bot y publie sanctions, tickets, arrivées et modifications.',
      href: `${base}/logs?tab=channels`,
      cta: logCount ? 'Modifier' : 'Configurer',
      done: logCount > 0,
    },
    {
      key: 'team',
      title: 'Désigner les rôles du staff',
      desc: team ? `${team} rôle(s) staff ou administrateur.` : 'Ils donnent accès à la modération, aux tickets et à la whitelist.',
      href: `${base}/settings#equipe`,
      cta: team ? 'Modifier' : 'Choisir',
      done: team > 0,
    },
    {
      key: 'welcome',
      title: 'Accueillir les nouveaux membres',
      desc: m.welcome && welcome?.enabled && welcome.channelId ? 'Message de bienvenue actif.' : 'Message, image et message privé à l’arrivée.',
      href: `${base}/welcome`,
      cta: 'Ouvrir',
      done: Boolean(m.welcome && welcome?.enabled && welcome.channelId),
    },
    {
      key: 'tickets',
      title: ticketTypes && !ticketPanels ? 'Publier un panneau de tickets' : 'Ouvrir le support par tickets',
      desc: ticketTypes && ticketPanels ? `${ticketTypes} raison(s), ${ticketPanels} panneau(x) publié(s).` : ticketTypes ? 'Les raisons existent : publiez le bouton d’ouverture dans un salon.' : 'Créez les raisons d’ouverture puis publiez un panneau.',
      href: ticketTypes && !ticketPanels ? `${base}/tickets/panels` : `${base}/tickets`,
      cta: 'Ouvrir',
      done: Boolean(m.tickets && ticketTypes > 0 && ticketPanels > 0),
    },
    {
      key: 'protections',
      title: 'Activer les protections',
      desc: m.antiraid && protections ? `${protections} protection(s) active(s) sur 7.` : 'Anti-nuke, anti-spam, liens et arrivées massives.',
      href: `${base}/moderation?tab=antiraid`,
      cta: 'Régler',
      done: Boolean(m.antiraid && protections > 0),
    },
  ];
  if (m.fivem) {
    steps.push({ key: 'fivem', title: 'Relier un serveur FiveM', desc: fivemServers ? `${fivemServers} serveur(s) relié(s).` : 'Statut en direct, joueurs et synchronisation des sanctions.', href: fivemServers ? `${base}/fivem` : `${base}/fivem/new`, cta: fivemServers ? 'Voir' : 'Ajouter', done: fivemServers > 0 });
  }
  if (m.whitelist) {
    steps.push({ key: 'whitelist', title: 'Préparer la whitelist', desc: whitelist?.reviewChannelId ? 'Salon d’examen choisi.' : 'Choisissez le salon où le staff examine les candidatures.', href: `${base}/whitelist?tab=config`, cta: 'Configurer', done: Boolean(whitelist?.reviewChannelId) });
  }
  if (m.shop) {
    steps.push({ key: 'shop', title: 'Ajouter un premier produit', desc: products ? `${products} produit(s) en boutique.` : 'Le catalogue alimente les annonces et le suivi des commandes.', href: `${base}/shop?tab=products`, cta: products ? 'Voir' : 'Ajouter', done: products > 0 });
  }
  return steps;
}

export interface OverviewCharts {
  members: MirrorChartModel;
  tickets: LineChartModel;
  sanctions: HBarsModel;
  /** Tickets en attente (ouverts ou pris en charge) */
  backlog: number;
}

const DAYS = 30;

/** Graphiques de la vue d'ensemble sur 30 jours : flux de membres (table Log), tickets ouverts/fermés, sanctions par type. */
export async function buildOverviewCharts(guildId: string, timeZone: string, typeLabels: Record<SanctionType, string>, now: Date = new Date()): Promise<OverviewCharts> {
  const axis = dayAxis(DAYS, timeZone, now);
  const since = new Date(now.getTime() - (DAYS + 1) * 86_400_000);
  const [memberLogs, tickets, stats, backlog] = await Promise.all([
    soft(
      'memberLogs',
      () => prisma.log.findMany({ where: { guildId, category: 'MEMBER', action: { in: ['member.join', 'member.leave'] }, createdAt: { gte: since } }, select: { action: true, targetId: true, createdAt: true }, orderBy: { createdAt: 'asc' }, take: 50_000 }),
      [] as { action: string; targetId: string | null; createdAt: Date }[],
    ),
    soft(
      'tickets',
      () => prisma.ticket.findMany({ where: { guildId, OR: [{ createdAt: { gte: since } }, { closedAt: { gte: since } }] }, select: { createdAt: true, closedAt: true }, take: 50_000 }),
      [] as { createdAt: Date; closedAt: Date | null }[],
    ),
    soft('sanctions', () => moderationService.stats(guildId, DAYS), { total: 0, byType: {} as Partial<Record<SanctionType, number>>, activeWarnings: 0, activeBans: 0, activeMutes: 0 }),
    soft('backlog', () => prisma.ticket.count({ where: { guildId, status: { in: ['OPEN', 'CLAIMED'] } } }), 0),
  ]);

  // Un départ peut être journalisé deux fois (événement + module Départ) : un membre compte une fois par jour et par sens.
  const seen = new Set<string>();
  const joins: Date[] = [];
  const leaves: Date[] = [];
  for (const l of Array.isArray(memberLogs) ? memberLogs : []) {
    const day = new Date(l.createdAt).toISOString().slice(0, 10);
    const id = `${l.action}:${l.targetId ?? Math.random()}:${day}`;
    if (seen.has(id)) continue;
    seen.add(id);
    if (l.action === 'member.join') joins.push(new Date(l.createdAt));
    else if (l.action === 'member.leave') leaves.push(new Date(l.createdAt));
  }
  const list = Array.isArray(tickets) ? tickets : [];
  const members = mirrorChart('chart-members', axis, { key: 'joins', label: 'Arrivées', slot: 1, values: bucketByDay(joins, axis, timeZone) }, { key: 'leaves', label: 'Départs', slot: 2, values: bucketByDay(leaves, axis, timeZone) });
  const ticketsChart = lineChart('chart-tickets', axis, [
    { key: 'opened', label: 'Ouverts', slot: 1, values: bucketByDay(list.map((t) => (t.createdAt ? new Date(t.createdAt) : null)), axis, timeZone) },
    { key: 'closed', label: 'Fermés', slot: 2, values: bucketByDay(list.map((t) => (t.closedAt ? new Date(t.closedAt) : null)), axis, timeZone) },
  ]);
  const byType = stats.byType ?? {};
  const sanctions = hbarsChart(
    'chart-sanctions',
    (Object.keys(byType) as SanctionType[]).map((t) => ({ label: typeLabels[t] ?? t, value: byType[t] ?? 0 })),
  );
  return { members, tickets: ticketsChart, sanctions, backlog: typeof backlog === 'number' ? backlog : 0 };
}
