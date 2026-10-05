import fs from 'node:fs';
import path from 'node:path';
import { ROOT, rel, runStandalone, walkFiles, type CheckResult } from './_lib';

/**
 * Références mortes : commandes slash supprimées (remplacées par `/config module:<x>` ou une commande d'action),
 * variables d'environnement retirées (REMOVED_ENV), dans le code, les locales, la doc et la ressource FiveM.
 */

/** Commandes supprimées → remplacement à indiquer. */
export const REMOVED_COMMANDS: Record<string, string> = {
  'guild-config': '/config module:general',
  'welcome-config': '/config module:bienvenue',
  'leave-config': '/config module:bienvenue',
  'ticket-config': '/config module:tickets',
  'ticket-type': '/config module:tickets',
  'ticket-panel': '/config module:tickets',
  'mod-config': '/config module:moderation',
  antiraid: '/config module:moderation',
  autorole: '/config module:roles',
  rolemenu: '/config module:roles',
  reactionrole: '/config module:roles',
  notifications: '/config module:roles',
  fivem: '/config module:fivem',
  'br-admin': '/config module:battleroyale',
  language: '/config module:general',
  'language-setup': '/config module:general',
  template: '/config (module concerné)',
  purge: '/clear messages',
  'clear-salon': '/clear salon',
};
/** Sous-commandes supprimées (`commande sous-commande` → remplacement / motif). Détecte aussi `/clear messages|serveur`. */
export const REMOVED_SUBCOMMANDS: Record<string, string> = {
  'clear serveur': 'retirée (trop destructrice) — /clear salon pour un salon',
};
/** Variables d'environnement retirées (DEEPL_API_KEY / MYMEMORY_EMAIL sont de nouveau utilisées par la traduction automatique FR → EN). */
export const REMOVED_ENV: string[] = [];

/** Mentions légitimes de `/fivem` : namespace Socket.IO (pas une commande). */
const ALLOWED_CONTEXT: Record<string, RegExp> = { fivem: /Socket\.IO|io\.of\(|io\(|namespace/i };

const SELF = path.join(ROOT, 'scripts', 'checks');

export async function run(): Promise<CheckResult> {
  const problems: string[] = [];
  const notes: string[] = [];
  const files = [
    ...walkFiles(path.join(ROOT, 'src'), ['.ts', '.json', '.md']),
    ...walkFiles(path.join(ROOT, 'docs'), ['.md']),
    ...walkFiles(path.join(ROOT, 'fivem-resource'), ['.lua', '.md', '.cfg']),
    ...walkFiles(path.join(ROOT, 'scripts'), ['.ts', '.js']).filter((f) => !f.startsWith(SELF)),
    ...['README.md', '.env.example', 'render.yaml', 'package.json'].map((f) => path.join(ROOT, f)).filter((f) => fs.existsSync(f)),
  ];
  const names = Object.keys(REMOVED_COMMANDS).sort((a, b) => b.length - a.length);
  const slash = new RegExp(`(?<![\\w./:<>@#~%-])/(${names.map((n) => n.replace(/-/g, '\\-')).join('|')})(?![\\w-])`, 'g');
  const env = REMOVED_ENV.length ? new RegExp(`\\b(${REMOVED_ENV.join('|')})\\b`, 'g') : null;
  const subs = Object.entries(REMOVED_SUBCOMMANDS).map(([full, hint]) => {
    const [cmd = '', sub = ''] = full.split(' ');
    return { full, hint, cmd, sub, re: new RegExp(`(?<![\\w./:<>@#~%-])/${cmd} (?:[\\w-]+\\|)*${sub}(?![\\w-])`) };
  });
  let lines = 0;
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    text.split('\n').forEach((line, i) => {
      lines++;
      for (const m of line.matchAll(slash)) {
        const name = m[1]!;
        if (ALLOWED_CONTEXT[name]?.test(line)) continue;
        problems.push(`commande supprimée /${name} (→ ${REMOVED_COMMANDS[name]}) — ${rel(file)}:${i + 1}`);
      }
      if (env) for (const m of line.matchAll(env)) problems.push(`variable retirée ${m[1]} — ${rel(file)}:${i + 1}`);
      for (const s of subs) if (s.re.test(line)) problems.push(`sous-commande supprimée /${s.full} (${s.hint}) — ${rel(file)}:${i + 1}`);
    });
  }
  // Aucune commande enregistrée sous un nom supprimé
  for (const file of walkFiles(path.join(ROOT, 'src', 'commands'), ['.ts'])) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/new SlashCommandBuilder\(\)\s*\.setName\('([^']+)'\)/g)) {
      if (REMOVED_COMMANDS[m[1]!]) problems.push(`commande supprimée encore déclarée : /${m[1]} — ${rel(file)}`);
      for (const s of subs) if (s.cmd === m[1] && new RegExp(`\\.addSubcommand\\(\\(\\w+\\)\\s*=>\\s*\\w+\\s*\\.setName\\('${s.sub}'\\)`).test(text)) problems.push(`sous-commande supprimée encore déclarée : /${s.full} — ${rel(file)}`);
    }
  }
  notes.push(`${files.length} fichiers, ${lines} lignes analysés`);
  return { name: 'Références mortes (commandes / variables supprimées)', problems, notes, summary: `${files.length} fichiers analysés, ${problems.length} référence(s) morte(s)` };
}

if (require.main === module) void runStandalone(run);
