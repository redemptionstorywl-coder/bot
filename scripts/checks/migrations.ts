import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, runStandalone, type CheckResult } from './_lib';

/**
 * Migrations ⇄ schema.prisma, sans base de données :
 *  1. SQL attendu = `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script` ;
 *  2. SQL réel = toutes les migrations de prisma/migrations appliquées dans l'ordre à un modèle en mémoire
 *     (CREATE / ALTER / DROP TABLE, index, clés primaires et étrangères) ;
 *  3. comparaison table par table, colonne par colonne (type, nullabilité, défaut), index, clés primaires / étrangères, options.
 * Un écart se corrige par une NOUVELLE migration (ne jamais modifier une migration déjà appliquée).
 *
 * Option : SHADOW_DATABASE_URL=mysql://… lance aussi `prisma migrate diff --from-migrations` sur une vraie base
 * (MySQL 8 : diff vide attendu ; MariaDB : seules des redéfinitions de colonnes JSON peuvent apparaître, artefact connu).
 */

interface Table {
  columns: Map<string, string>;
  indexes: Map<string, string>;
  foreignKeys: Map<string, string>;
  primaryKey: string | null;
  options: string;
}
type Model = Map<string, Table>;

const norm = (s: string) => s.replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').trim();
const unquote = (s: string) => s.replace(/`/g, '');

/** Découpe au niveau 0 (parenthèses, crochets, accolades, chaînes) sur `sep`. */
function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') quote = c;
    else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === sep && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out.map((x) => x.trim()).filter(Boolean);
}

function statements(sql: string): string[] {
  const noComments = sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');
  return splitTop(noComments, ';').map((s) => s.trim()).filter(Boolean);
}

class SqlModel {
  readonly tables: Model = new Map();
  readonly errors: string[] = [];

  private table(name: string, origin: string): Table | null {
    const t = this.tables.get(name);
    if (!t) this.errors.push(`${origin} : table \`${name}\` inexistante`);
    return t ?? null;
  }

  private addDefinition(t: Table, raw: string, origin: string): void {
    const def = norm(raw);
    let m: RegExpMatchArray | null;
    if ((m = def.match(/^`([^`]+)` (.+)$/))) t.columns.set(m[1]!, m[2]!);
    else if ((m = def.match(/^PRIMARY KEY ?\((.+)\)$/i))) t.primaryKey = unquote(m[1]!);
    else if ((m = def.match(/^((?:UNIQUE |FULLTEXT )?INDEX) `([^`]+)` ?\((.+)\)$/i))) t.indexes.set(m[2]!, `${m[1]!.toUpperCase()}(${unquote(m[3]!)})`);
    else if ((m = def.match(/^CONSTRAINT `([^`]+)` (FOREIGN KEY .+)$/i))) t.foreignKeys.set(m[1]!, unquote(m[2]!));
    else this.errors.push(`${origin} : définition non reconnue « ${def.slice(0, 80)} »`);
  }

  apply(sql: string, origin: string): void {
    for (const stmt of statements(sql)) {
      const s = norm(stmt);
      let m: RegExpMatchArray | null;
      if ((m = stmt.match(/^CREATE TABLE `([^`]+)` \(([\s\S]*)\)\s*([^)]*)$/))) {
        const t: Table = { columns: new Map(), indexes: new Map(), foreignKeys: new Map(), primaryKey: null, options: norm(m[3]!) };
        if (this.tables.has(m[1]!)) this.errors.push(`${origin} : table \`${m[1]}\` créée deux fois`);
        this.tables.set(m[1]!, t);
        for (const def of splitTop(m[2]!, ',')) this.addDefinition(t, def, origin);
      } else if ((m = s.match(/^DROP TABLE `([^`]+)`$/))) {
        if (!this.tables.delete(m[1]!)) this.errors.push(`${origin} : DROP TABLE \`${m[1]}\` inexistante`);
      } else if ((m = s.match(/^CREATE (UNIQUE |FULLTEXT )?INDEX `([^`]+)` ON `([^`]+)` ?\((.+)\)$/i))) {
        this.table(m[3]!, origin)?.indexes.set(m[2]!, `${(m[1] ?? '').toUpperCase()}INDEX(${unquote(m[4]!)})`);
      } else if ((m = s.match(/^DROP INDEX `([^`]+)` ON `([^`]+)`$/i))) {
        const t = this.table(m[2]!, origin);
        if (t && !t.indexes.delete(m[1]!)) this.errors.push(`${origin} : DROP INDEX \`${m[1]}\` inexistant`);
      } else if ((m = s.match(/^RENAME TABLE `([^`]+)` TO `([^`]+)`$/i))) {
        const t = this.table(m[1]!, origin);
        if (t) {
          this.tables.delete(m[1]!);
          this.tables.set(m[2]!, t);
        }
      } else if ((m = stmt.match(/^ALTER TABLE `([^`]+)` ([\s\S]+)$/))) {
        const t = this.table(m[1]!, origin);
        if (!t) continue;
        for (const clause of splitTop(m[2]!, ',').map(norm)) this.alter(t, m[1]!, clause, origin);
      } else this.errors.push(`${origin} : instruction non reconnue « ${s.slice(0, 80)} »`);
    }
  }

  private alter(t: Table, table: string, c: string, origin: string): void {
    let m: RegExpMatchArray | null;
    const missing = (what: string) => this.errors.push(`${origin} : ${what} inexistant(e) dans \`${table}\``);
    if ((m = c.match(/^ADD COLUMN `([^`]+)` (.+)$/i))) t.columns.set(m[1]!, m[2]!);
    else if ((m = c.match(/^DROP COLUMN `([^`]+)`$/i))) {
      if (!t.columns.delete(m[1]!)) missing(`colonne \`${m[1]}\``);
    } else if ((m = c.match(/^MODIFY (?:COLUMN )?`([^`]+)` (.+)$/i))) {
      if (!t.columns.has(m[1]!)) missing(`colonne \`${m[1]}\``);
      t.columns.set(m[1]!, m[2]!);
    } else if ((m = c.match(/^CHANGE (?:COLUMN )?`([^`]+)` `([^`]+)` (.+)$/i))) {
      if (!t.columns.delete(m[1]!)) missing(`colonne \`${m[1]}\``);
      t.columns.set(m[2]!, m[3]!);
    } else if ((m = c.match(/^RENAME COLUMN `([^`]+)` TO `([^`]+)`$/i))) {
      const def = t.columns.get(m[1]!);
      if (def === undefined) missing(`colonne \`${m[1]}\``);
      else {
        t.columns.delete(m[1]!);
        t.columns.set(m[2]!, def);
      }
    } else if ((m = c.match(/^ADD CONSTRAINT `([^`]+)` (FOREIGN KEY .+)$/i))) t.foreignKeys.set(m[1]!, unquote(m[2]!));
    else if ((m = c.match(/^DROP FOREIGN KEY `([^`]+)`$/i))) {
      if (!t.foreignKeys.delete(m[1]!)) missing(`clé étrangère \`${m[1]}\``);
    } else if ((m = c.match(/^ADD PRIMARY KEY ?\((.+)\)$/i))) t.primaryKey = unquote(m[1]!);
    else if (/^DROP PRIMARY KEY$/i.test(c)) t.primaryKey = null;
    else if ((m = c.match(/^ADD ((?:UNIQUE |FULLTEXT )?INDEX) `([^`]+)` ?\((.+)\)$/i))) t.indexes.set(m[2]!, `${m[1]!.toUpperCase()}(${unquote(m[3]!)})`);
    else if ((m = c.match(/^DROP INDEX `([^`]+)`$/i))) {
      if (!t.indexes.delete(m[1]!)) missing(`index \`${m[1]}\``);
    } else if ((m = c.match(/^RENAME INDEX `([^`]+)` TO `([^`]+)`$/i))) {
      const def = t.indexes.get(m[1]!);
      if (def === undefined) missing(`index \`${m[1]}\``);
      else {
        t.indexes.delete(m[1]!);
        t.indexes.set(m[2]!, def);
      }
    } else this.errors.push(`${origin} : clause ALTER non reconnue « ${c.slice(0, 80)} » (\`${table}\`)`);
  }
}

function compare(expected: Model, actual: Model): string[] {
  const out: string[] = [];
  for (const name of new Set([...expected.keys(), ...actual.keys()])) {
    const e = expected.get(name);
    const a = actual.get(name);
    if (!a) {
      out.push(`table \`${name}\` du schéma absente des migrations`);
      continue;
    }
    if (!e) {
      out.push(`table \`${name}\` créée par les migrations mais absente du schéma`);
      continue;
    }
    const diffMap = (kind: string, em: Map<string, string>, am: Map<string, string>) => {
      for (const k of new Set([...em.keys(), ...am.keys()])) {
        const ev = em.get(k);
        const av = am.get(k);
        if (ev === av) continue;
        if (av === undefined) out.push(`\`${name}\` : ${kind} \`${k}\` manquant(e) dans les migrations (schéma : ${ev})`);
        else if (ev === undefined) out.push(`\`${name}\` : ${kind} \`${k}\` en trop dans les migrations (${av})`);
        else out.push(`\`${name}\` : ${kind} \`${k}\` différent(e) — schéma « ${ev} » / migrations « ${av} »`);
      }
    };
    diffMap('colonne', e.columns, a.columns);
    diffMap('index', e.indexes, a.indexes);
    diffMap('clé étrangère', e.foreignKeys, a.foreignKeys);
    if (e.primaryKey !== a.primaryKey) out.push(`\`${name}\` : clé primaire — schéma (${e.primaryKey}) / migrations (${a.primaryKey})`);
    if (e.options !== a.options) out.push(`\`${name}\` : options — schéma « ${e.options} » / migrations « ${a.options} »`);
  }
  return out;
}

function prisma(args: string[], env: NodeJS.ProcessEnv = process.env): string {
  const bin = path.join(ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'prisma.cmd' : 'prisma');
  return execFileSync(fs.existsSync(bin) ? bin : 'npx', fs.existsSync(bin) ? args : ['prisma', ...args], {
    cwd: ROOT,
    env: { ...env, DATABASE_URL: env.DATABASE_URL || 'mysql://check:check@localhost:3306/check', PRISMA_HIDE_UPDATE_MESSAGE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).toString();
}

export async function run(): Promise<CheckResult> {
  const problems: string[] = [];
  const notes: string[] = [];
  const migrationsDir = path.join(ROOT, 'prisma', 'migrations');
  const dirs = fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  const actual = new SqlModel();
  for (const d of dirs) {
    const file = path.join(migrationsDir, d, 'migration.sql');
    if (!fs.existsSync(file)) {
      problems.push(`migration ${d} sans migration.sql`);
      continue;
    }
    actual.apply(fs.readFileSync(file, 'utf8'), d);
  }
  const expected = new SqlModel();
  expected.apply(prisma(['migrate', 'diff', '--from-empty', '--to-schema-datamodel', 'prisma/schema.prisma', '--script']), 'schema.prisma');
  problems.push(...actual.errors, ...expected.errors.map((e) => `analyse du SQL attendu : ${e}`));
  problems.push(...compare(expected.tables, actual.tables));

  const columns = [...expected.tables.values()].reduce((n, t) => n + t.columns.size, 0);
  const shadow = process.env.SHADOW_DATABASE_URL;
  if (shadow) {
    const out = prisma(['migrate', 'diff', '--from-migrations', 'prisma/migrations', '--to-schema-datamodel', 'prisma/schema.prisma', '--shadow-database-url', shadow, '--script']);
    const stmts = statements(out);
    const nonJson = stmts.filter((s) => !splitTop(s.replace(/^ALTER TABLE `[^`]+`/, ''), ',').every((c) => /^MODIFY `[^`]+` JSON\b/i.test(norm(c))));
    if (!stmts.length || /empty migration/i.test(out)) notes.push('base fantôme : diff vide');
    else if (!nonJson.length) notes.push(`base fantôme : ${stmts.length} redéfinition(s) de colonnes JSON (artefact MariaDB, ignoré)`);
    else problems.push(...nonJson.map((s) => `base fantôme : écart « ${norm(s).slice(0, 160)} »`));
  } else notes.push('SHADOW_DATABASE_URL non défini : comparaison sur base réelle non lancée');
  if (problems.length) notes.push('Corriger par une NOUVELLE migration : npx prisma migrate dev --create-only --name <nom> (ne jamais modifier une migration déjà appliquée).');
  return {
    name: 'Migrations ⇄ schema.prisma',
    problems,
    notes,
    summary: `${dirs.length} migrations, ${expected.tables.size} tables / ${columns} colonnes attendues, ${problems.length} écart(s)`,
  };
}

if (require.main === module) void runStandalone(run);
