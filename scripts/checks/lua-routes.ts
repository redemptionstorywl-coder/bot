import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import type { ZodTypeAny } from 'zod';
import * as fivemSchemas from '../../src/services/fivem/schemas';
import { ROOT, rel, runStandalone, type CheckResult } from './_lib';

/**
 * Ressource Lua rs_bridge ⇄ API REST src/api/fivem.ts :
 *  - URL de base (montage `/api/fivem` du dashboard + `/servers/:guildId/:serverKey`) ;
 *  - en-têtes envoyés (x-api-key, x-server-key) lus par l'API ;
 *  - chaque appel `RSBridge.post|get('/…')` correspond à une route de même méthode, authentifiée ;
 *  - corps envoyés ⇄ schémas Zod (clés inconnues, clés requises manquantes, tableaux d'objets imbriqués) ;
 *  - champs de réponse lus par le Lua (`data.x`, `data.status.x`, `action.x`) ⇄ type des réponses de l'API.
 */

const LUA_DIR = path.join(ROOT, 'fivem-resource', 'rs_bridge', 'server');
const API_FILE = path.join(ROOT, 'src', 'api', 'fivem.ts');
const MOUNT_FILE = path.join(ROOT, 'dashboard', 'app.ts');

/** Schéma Zod appliqué au corps de chaque route POST (adaptateur CUSTOM pour stats / sanctions). */
const REQUEST_SCHEMAS: Record<string, string> = {
  'POST /status': 'serverStatusSchema',
  'POST /players/join': 'playerJoinSchema',
  'POST /players/leave': 'playerLeaveSchema',
  'POST /players/name': 'playerNameSchema',
  'POST /check': 'connectionCheckSchema',
  'POST /sanctions': 'normalizedSanctionSchema',
  'POST /stats': 'normalizedStatsSchema',
  'POST /logs': 'gameLogBatchSchema',
};

// ───────────── Mini-analyse Lua ─────────────

/** Retire commentaires et contenu des chaînes (remplacé par des espaces) en conservant les positions. */
function maskLua(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (src.startsWith('--[[', i) || src.startsWith('--[=[', i)) {
      const close = src.indexOf(src.startsWith('--[[', i) ? ']]' : ']=]', i);
      const end = close < 0 ? src.length : close + (src.startsWith('--[[', i) ? 2 : 3);
      out += src.slice(i, end).replace(/[^\n]/g, ' ');
      i = end;
    } else if (src.startsWith('--', i)) {
      const end = src.indexOf('\n', i) < 0 ? src.length : src.indexOf('\n', i);
      out += ' '.repeat(end - i);
      i = end;
    } else if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      out += c + ' '.repeat(Math.max(0, j - i - 1)) + c;
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** Index de la parenthèse / accolade fermante correspondant à `open` (texte masqué). */
function matching(masked: string, open: number): number {
  const pairs: Record<string, string> = { '(': ')', '{': '}', '[': ']' };
  const stack: string[] = [];
  for (let i = open; i < masked.length; i++) {
    const c = masked[i]!;
    if (pairs[c]) stack.push(pairs[c]!);
    else if (c === stack[stack.length - 1]) {
      stack.pop();
      if (!stack.length) return i;
    }
  }
  return -1;
}

/** Découpe au niveau 0 sur les virgules / points-virgules. */
function splitTop(masked: string, from: number, to: number): [number, number][] {
  const parts: [number, number][] = [];
  let depth = 0;
  let start = from;
  for (let i = from; i < to; i++) {
    const c = masked[i]!;
    if ('({['.includes(c)) depth++;
    else if (')}]'.includes(c)) depth--;
    else if ((c === ',' || c === ';') && depth === 0) {
      parts.push([start, i]);
      start = i + 1;
    }
  }
  parts.push([start, to]);
  return parts.filter(([a, b]) => masked.slice(a, b).trim());
}

/** Fin du bloc `function … end` commençant à `pos` (mot-clé function). */
function functionEnd(masked: string, pos: number): number {
  const re = /\b(function|if|do|repeat|end|until)\b/g;
  re.lastIndex = pos;
  let depth = 0;
  for (let m = re.exec(masked); m; m = re.exec(masked)) {
    if (['function', 'if', 'do', 'repeat'].includes(m[1]!)) depth++;
    else depth--;
    if (depth === 0) return m.index + m[0].length;
  }
  return masked.length;
}

interface LuaTable {
  /** clé → expression de la valeur et position (pour résoudre une valeur imbriquée) */
  keys: Map<string, { expr: string; pos: number }>;
  isArrayOf?: LuaTable;
}

class LuaFile {
  readonly masked: string;
  constructor(
    readonly file: string,
    readonly src: string,
  ) {
    this.masked = maskLua(src);
  }

  /** Clés de premier niveau d'un constructeur `{ … }` commençant à `open`. */
  tableAt(open: number): LuaTable {
    const close = matching(this.masked, open);
    const keys: LuaTable['keys'] = new Map();
    for (const [a, b] of splitTop(this.masked, open + 1, close)) {
      const entry = this.src.slice(a, b);
      const m = entry.match(/^\s*(?:\[\s*['"]([^'"]+)['"]\s*\]|([A-Za-z_]\w*))\s*=(?!=)\s*([\s\S]*)$/);
      if (m) keys.set(m[1] ?? m[2]!, { expr: m[3]!.trim(), pos: a });
    }
    return { keys };
  }

  /** Résout l'expression d'un argument (table littérale, variable locale, appel de fonction locale). */
  resolve(expr: string, before: number, scopeStart = 0, depth = 0): LuaTable | null {
    if (depth > 6) return null;
    // `x = list end` / `if row then rows[#rows + 1] = row end` : seule l'expression compte
    const e = expr.replace(/\s+(end|then|else|elseif)\b[\s\S]*$/, '').replace(/;\s*$/, '').trim();
    if (e.startsWith('{')) {
      const open = this.src.indexOf(e, scopeStart);
      return open >= 0 ? this.tableAt(open) : null;
    }
    // Premier appel d'une fonction définie dans le fichier (`type(e) == 'table' and buildRow(e) or nil` → buildRow)
    const call = [...e.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)].find((c) => this.masked.search(new RegExp(`\\bfunction\\s+${c[1]}\\s*\\(`)) >= 0);
    const ident = e.match(/^([A-Za-z_]\w*)$/);
    if (ident) {
      const name = ident[1]!;
      const decl = [...this.masked.slice(scopeStart, before).matchAll(new RegExp(`\\blocal\\s+${name}\\s*=\\s*`, 'g'))].pop();
      if (!decl) return null;
      const rhsStart = scopeStart + decl.index! + decl[0].length;
      let table: LuaTable | null;
      if (this.masked[rhsStart] === '{') {
        table = this.tableAt(rhsStart);
        if (!table.keys.size) {
          // Tableau rempli par `name[#name + 1] = expr`
          const push = this.src.slice(rhsStart, before).match(new RegExp(`\\b${name}\\[#${name}\\s*\\+\\s*1\\]\\s*=\\s*([^\\n]+)`));
          if (push) {
            const inner = this.resolve(push[1]!, rhsStart + push.index! + push[0].length, rhsStart, depth + 1);
            if (inner) table = { keys: new Map(), isArrayOf: inner };
          }
        }
      } else {
        const lineEnd = this.src.indexOf('\n', rhsStart);
        table = this.resolve(this.src.slice(rhsStart, lineEnd), lineEnd, scopeStart, depth + 1);
      }
      if (table && !table.isArrayOf) {
        // Champs ajoutés ensuite : `name.key = …`
        for (const m of this.src.slice(rhsStart, before).matchAll(new RegExp(`\\b${name}\\.([A-Za-z_]\\w*)\\s*=(?!=)\\s*([^\\n]+)`, 'g'))) table.keys.set(m[1]!, { expr: m[2]!.trim(), pos: rhsStart + m.index! });
      }
      return table;
    }
    if (call) {
      const fname = call[1]!;
      const def = this.masked.search(new RegExp(`\\bfunction\\s+${fname}\\s*\\(`));
      if (def < 0) return null;
      const end = functionEnd(this.masked, def);
      const ret = [...this.masked.slice(def, end).matchAll(/\breturn\s+/g)].map((m) => def + m.index! + m[0].length).find((p) => !/^(nil|false|true)\b/.test(this.masked.slice(p)));
      if (ret === undefined) return null;
      if (this.masked[ret] === '{') return this.tableAt(ret);
      const lineEnd = this.src.indexOf('\n', ret);
      return this.resolve(this.src.slice(ret, lineEnd), ret, def, depth + 1);
    }
    return null;
  }
}

interface LuaCall {
  method: 'GET' | 'POST';
  route: string;
  body: LuaTable | null;
  bodyExpr: string | null;
  /** Champs lus dans le callback (`data.x`, `data.x.y`) */
  reads: string[];
  where: string;
}

function luaCalls(lf: LuaFile): LuaCall[] {
  const out: LuaCall[] = [];
  for (const m of lf.src.matchAll(/RSBridge\.(post|get)\(\s*'([^']+)'/g)) {
    const open = lf.src.indexOf('(', m.index!);
    const close = matching(lf.masked, open);
    const args = splitTop(lf.masked, open + 1, close).map(([a, b]) => lf.src.slice(a, b).trim());
    const method = m[1] === 'post' ? 'POST' : 'GET';
    const bodyExpr = method === 'POST' ? (args[1] ?? null) : null;
    const cbExpr = method === 'POST' ? args[2] : args[1];
    const reads: string[] = [];
    if (cbExpr?.startsWith('function')) {
      const param = cbExpr.match(/^function\s*\(\s*\w+\s*,\s*(\w+)/)?.[1];
      if (param) for (const r of cbExpr.matchAll(new RegExp(`\\b${param}\\.([A-Za-z_]\\w*(?:\\.[A-Za-z_]\\w*)?)`, 'g'))) reads.push(r[1]!);
    }
    const line = lf.src.slice(0, m.index!).split('\n').length;
    out.push({ method, route: m[2]!, body: bodyExpr ? lf.resolve(bodyExpr, m.index!) : null, bodyExpr, reads: [...new Set(reads)], where: `${rel(lf.file)}:${line}` });
  }
  return out;
}

// ───────────── Schémas Zod ─────────────

type ZodNode = ZodTypeAny & { _def: { typeName: string; schema?: ZodTypeAny; innerType?: ZodTypeAny; type?: ZodTypeAny; options?: ZodTypeAny[] }; shape?: Record<string, ZodTypeAny> };
function unwrap(s: ZodTypeAny): ZodNode {
  let n = s as ZodNode;
  for (let i = 0; i < 10; i++) {
    const tn = n._def.typeName;
    if (tn === 'ZodEffects' && n._def.schema) n = n._def.schema as ZodNode;
    else if ((tn === 'ZodOptional' || tn === 'ZodDefault' || tn === 'ZodNullable') && n._def.innerType) n = n._def.innerType as ZodNode;
    else if (tn === 'ZodUnion' && n._def.options?.length) n = n._def.options[0] as ZodNode; // objet | tableau d'objets : la forme objet
    else break;
  }
  return n;
}

function compareBody(table: LuaTable, schema: ZodTypeAny, ctx: string, problems: string[]): void {
  const node = unwrap(schema);
  if (node._def.typeName === 'ZodArray' && table.isArrayOf) return compareBody(table.isArrayOf, node._def.type!, `${ctx}[]`, problems);
  if (table.isArrayOf) return compareBody(table.isArrayOf, schema, `${ctx}[]`, problems);
  const shape = (node as { shape?: Record<string, ZodTypeAny> }).shape;
  if (!shape) return;
  for (const key of table.keys.keys()) if (!(key in shape)) problems.push(`${ctx} : champ « ${key} » envoyé par le Lua mais absent du schéma (ignoré par l'API)`);
  for (const [key, field] of Object.entries(shape)) if (!field.isOptional() && !table.keys.has(key)) problems.push(`${ctx} : champ requis « ${key} » non envoyé par le Lua`);
}

// ───────────── API (TypeScript) ─────────────

interface ApiRoute {
  method: 'GET' | 'POST';
  route: string;
  authenticated: boolean;
  /** Type des réponses JSON (union de tous les res.json du handler) */
  responses: ts.Type[];
}

export async function run(): Promise<CheckResult> {
  const problems: string[] = [];
  const notes: string[] = [];
  const luaFiles = fs.readdirSync(LUA_DIR).filter((f) => f.endsWith('.lua')).map((f) => new LuaFile(path.join(LUA_DIR, f), fs.readFileSync(path.join(LUA_DIR, f), 'utf8')));
  const main = luaFiles.find((f) => f.file.endsWith('main.lua'))!;

  // URL de base + montage
  const fmt = main.src.match(/local baseUrl = \('([^']+)'\)/)?.[1];
  const luaBase = fmt ? fmt.replace('%s', '').replace('%s', ':guildId').replace('%s', ':serverKey') : null;
  const mount = fs.existsSync(MOUNT_FILE) ? fs.readFileSync(MOUNT_FILE, 'utf8').match(/app\.use\('([^']+)',\s*createFiveMRouter\(/)?.[1] : '/api/fivem';
  const apiSrc = fs.readFileSync(API_FILE, 'utf8');
  const apiBase = apiSrc.match(/const base = '([^']+)'/)?.[1];
  if (!luaBase || !mount || !apiBase) problems.push('URL de base introuvable (Lua baseUrl, montage du routeur ou constante base)');
  else if (luaBase !== `${mount}${apiBase}`) problems.push(`URL de base : Lua « ${luaBase} » ≠ API « ${mount}${apiBase} »`);

  // En-têtes
  const headerBlock = main.src.match(/local headers = \{([\s\S]*?)\n\}/)?.[1] ?? '';
  const luaHeaders = [...headerBlock.matchAll(/\['([^']+)'\]\s*=/g)].map((m) => m[1]!.toLowerCase());
  for (const h of luaHeaders.filter((x) => x.startsWith('x-'))) if (!apiSrc.includes(`req.header('${h}')`)) problems.push(`en-tête « ${h} » envoyé par le Lua mais jamais lu par l'API`);
  if (!luaHeaders.includes('x-api-key')) problems.push('le Lua n’envoie pas x-api-key (authentification impossible)');

  // Routes de l'API (AST + types)
  const program = ts.createProgram([API_FILE], { strict: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true, skipLibCheck: true, resolveJsonModule: true, noEmit: true });
  const checker = program.getTypeChecker();
  const sf = program.getSourceFile(API_FILE)!;
  const routes: ApiRoute[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ts.isIdentifier(n.expression.expression) && n.expression.expression.text === 'router' && ['get', 'post'].includes(n.expression.name.text)) {
      const first = n.arguments[0];
      let route: string | null = null;
      if (first && ts.isTemplateExpression(first) && first.head.text === '' && first.templateSpans[0]?.expression.getText() === 'base') route = first.templateSpans[0].literal.text;
      else if (first && ts.isStringLiteral(first)) route = `!${first.text}`; // hors base (health)
      if (route) {
        const responses: ts.Type[] = [];
        const findJson = (x: ts.Node) => {
          if (ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression) && x.expression.name.text === 'json' && x.arguments[0]) responses.push(checker.getTypeAtLocation(x.arguments[0]));
          ts.forEachChild(x, findJson);
        };
        n.arguments.slice(1).forEach(findJson);
        routes.push({ method: n.expression.name.text === 'post' ? 'POST' : 'GET', route, authenticated: n.arguments.some((a) => ts.isIdentifier(a) && a.text === 'authenticate'), responses });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  for (const r of routes) if (!r.route.startsWith('!') && !r.authenticated) problems.push(`route ${r.method} ${r.route} sans middleware authenticate`);

  /** Propriétés (chemin a.b) présentes dans au moins une réponse. */
  const hasPath = (types: ts.Type[], dotted: string): boolean =>
    types.some((t) => {
      let cur: ts.Type | undefined = t;
      for (const part of dotted.split('.')) {
        if (!cur) return false;
        const members: ts.Type[] = cur.isUnion() ? cur.types : [cur];
        const prop = members.map((m) => m.getProperty(part)).find(Boolean);
        if (!prop) return members.some((m) => checker.getIndexInfosOfType(m).length > 0);
        cur = checker.getTypeOfSymbol(prop);
        cur = checker.getNonNullableType(cur);
      }
      return true;
    });

  const schemas = fivemSchemas as unknown as Record<string, ZodTypeAny>;

  let calls = 0;
  for (const lf of luaFiles) {
    for (const call of luaCalls(lf)) {
      calls++;
      const key = `${call.method} ${call.route}`;
      const route = routes.find((r) => r.method === call.method && r.route === call.route);
      if (!route) {
        problems.push(`${key} appelé par le Lua (${call.where}) : aucune route correspondante dans src/api/fivem.ts`);
        continue;
      }
      if (call.method === 'POST') {
        const schemaName = REQUEST_SCHEMAS[key];
        if (!schemaName || !schemas[schemaName]) problems.push(`${key} : schéma de corps inconnu (REQUEST_SCHEMAS)`);
        else if (!call.body) problems.push(`${key} (${call.where}) : corps « ${call.bodyExpr} » non résolu dans le Lua`);
        else compareBody(call.body, schemas[schemaName]!, `${key} (${call.where})`, problems);
        // Tableaux d'objets imbriqués (ex. playerList)
        if (schemaName && schemas[schemaName] && call.body && !call.body.isArrayOf) {
          const shape = (unwrap(schemas[schemaName]!) as { shape?: Record<string, ZodTypeAny> }).shape ?? {};
          for (const [field, value] of call.body.keys) {
            const nested = shape[field] ? unwrap(shape[field]!) : null;
            if (nested?._def.typeName !== 'ZodArray' || unwrap(nested._def.type!)._def.typeName !== 'ZodObject') continue;
            const inner = lf.resolve(value.expr, value.pos);
            if (!inner) notes.push(`${key}.${field} : valeur « ${value.expr} » non résolue (non comparée)`);
            else compareBody(inner, nested, `${key}.${field}`, problems);
          }
        }
      }
      for (const read of call.reads) if (!hasPath(route.responses, read)) problems.push(`${key} (${call.where}) : le Lua lit « data.${read} », absent de la réponse de l'API`);
    }
  }

  // Actions Discord → jeu : champs lus par les handlers Lua (`action.x`) ⇄ GameActionPayload + id/type/createdAt
  const actionFields = new Set(['id', 'type', 'createdAt']);
  const syncSf = program.getSourceFiles().find((f) => f.fileName.endsWith(path.join('fivem', 'sync.ts')));
  syncSf?.forEachChild((n) => {
    if (ts.isInterfaceDeclaration(n) && n.name.text === 'GameActionPayload') for (const m of n.members) if (m.name && ts.isIdentifier(m.name)) actionFields.add(m.name.text);
  });
  for (const m of new Set([...main.src.matchAll(/\baction\.([A-Za-z_]\w*)/g)].map((x) => x[1]!))) if (!actionFields.has(m)) problems.push(`action.${m} lu par le Lua mais absent de GameActionPayload (src/services/fivem/sync.ts)`);

  for (const r of routes) {
    if (r.route.startsWith('!')) continue;
    const used = luaFiles.some((lf) => luaCalls(lf).some((c) => c.method === r.method && c.route === r.route));
    if (!used) notes.push(`route non utilisée par rs_bridge : ${r.method} ${r.route}`);
  }
  return { name: 'Lua rs_bridge ⇄ API FiveM', problems, notes, summary: `${calls} appels Lua, ${routes.length} routes API, ${problems.length} écart(s)` };
}

if (require.main === module) void runStandalone(run);
