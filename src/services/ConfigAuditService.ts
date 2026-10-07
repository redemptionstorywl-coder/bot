import { AsyncLocalStorage } from 'node:async_hooks';
import { BRAND } from '../config/constants';
import { loggingService } from './LoggingService';
import type { Translator } from './TranslationService';

/**
 * Journal des modifications faites dans les panneaux `/config` (log SYSTEM `config.change`, route hub : bot.config).
 * Convention des panneaux : chaque action réussie re-rend le panneau avec une notice ✅. Pendant l'exécution d'un composant
 * de configuration (namespaces `cfg-*`, `tcfg`, `welcome`), les notices de succès rendues sont capturées
 * (AsyncLocalStorage, sans rien changer aux handlers) puis journalisées en une seule entrée. Navigation pure = aucune notice.
 */

interface AuditScope {
  notes: string[];
}

const storage = new AsyncLocalStorage<AuditScope>();

/** Namespaces des composants de configuration (même règle que scripts/checks/customids.ts). */
export const isConfigNamespace = (ns: string): boolean => ns.startsWith('cfg-') || ns === 'tcfg' || ns === 'welcome';

export const configAudit = {
  /** Exécute `fn` en capturant les notices de succès rendues. */
  async run<T>(fn: () => Promise<T>): Promise<{ result: T; notes: string[] }> {
    const scope: AuditScope = { notes: [] };
    const result = await storage.run(scope, fn);
    return { result, notes: scope.notes };
  },

  /** Appelé par les fonctions de rendu des notices des panneaux. Sans effet hors d'un composant de configuration. */
  capture(notice: { type: string; text: string } | null | undefined): void {
    const scope = storage.getStore();
    if (!scope || !notice || notice.type !== 'success') return;
    const text = notice.text.trim().slice(0, 500);
    if (text && !scope.notes.includes(text) && scope.notes.length < 10) scope.notes.push(text);
  },

  /** Journalise les modifications capturées. */
  async log(input: { guildId: string; userId: string; namespace: string; action: string | null; notes: string[]; t: Translator }): Promise<void> {
    if (!input.notes.length) return;
    await loggingService.log({
      guildId: input.guildId,
      category: 'SYSTEM',
      action: 'config.change',
      title: input.t('logs.config.title'),
      description: input.notes.map((n) => `• ${n}`).join('\n'),
      fields: [
        { name: input.t('logs.config.panel'), value: `\`${input.namespace}\``, inline: true },
        { name: input.t('logs.fields.changed_by'), value: `<@${input.userId}> (\`${input.userId}\`)`, inline: true },
      ],
      actorId: input.userId,
      color: BRAND.colors.primary,
      data: { namespace: input.namespace, action: input.action, notes: input.notes, source: 'discord' },
    });
  },
};
