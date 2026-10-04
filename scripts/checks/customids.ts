import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { ROOT, rel, runStandalone, walkFiles, type CheckResult } from './_lib';

/**
 * customIds ⇄ handlers.
 *  1. Chaque customId généré (`buildCustomId('ns', 'action', …)`, helpers `gid('x')`, `rcid('x')`, `cid('x')`…, littéraux
 *     `setCustomId('ns:action')`) doit avoir un handler du bon type (bouton / menu / modal) pour son namespace, qui traite l'action.
 *  2. Chaque handler doit être atteignable (namespace généré quelque part) et chaque action qu'il déclare
 *     (`case 'x'`, `action === 'x'`, méthodes d'un objet `handlers`, tableaux `*_ACTIONS`, regex sur l'action) doit être générée.
 *  3. Les handlers de configuration (`cfg-*`, `tcfg`, `welcome`) exigent `permissions: { internal: 'admin' }`.
 */

type Kind = 'button' | 'select' | 'modal' | 'unknown';
const SRC = path.join(ROOT, 'src');
/** Namespaces réservés aux collectors locaux (pagination…). */
const RESERVED = new Set(['noop', 'pg']);
/** Actions traitées par la branche par défaut d'un handler (vérifiées à la main). */
const DEFAULT_BRANCH = new Set(['dm:confirm']);
/** Namespaces de configuration : admin obligatoire. */
const isConfigNamespace = (ns: string) => ns.startsWith('cfg-') || ns === 'tcfg' || ns === 'welcome';
/** Variables portant l'action dans les handlers. */
const ACTION_VARS = new Set(['action', 'kind']);

interface Gen {
  file: string;
  line: number;
  ns: string;
  actions: string[]; // '*' = partie dynamique
  subs: string[];
  kind: Kind;
  text: string;
}
interface Handler {
  file: string;
  kind: Kind;
  id: string;
  /** Tous les littéraux comparés (sens génération → handler) */
  handled: Set<string>;
  /** Actions explicitement déclarées (sens handler → génération) */
  declared: Map<string, number>;
  permissions: string;
}
/** Position d'un argument : littéral(s) ou index de paramètre du wrapper. */
type Slot = { lit: string[] } | { param: number } | null;
interface Wrapper {
  ns: Slot;
  action: Slot;
  sub: Slot;
  kind: Kind;
}

export async function run(): Promise<CheckResult> {
  const problems: string[] = [];
  const notes: string[] = [];
  const files = walkFiles(SRC, ['.ts']);
  const sources = new Map<string, ts.SourceFile>();
  for (const f of files) sources.set(f, ts.createSourceFile(f, fs.readFileSync(f, 'utf8'), ts.ScriptTarget.ES2022, true));

  const resolveImport = (from: string, spec: string): string | null => {
    if (!spec.startsWith('.')) return null;
    const base = path.resolve(path.dirname(from), spec);
    for (const c of [`${base}.ts`, path.join(base, 'index.ts')]) if (sources.has(c)) return c;
    return null;
  };
  const imports = new Map<string, Map<string, { file: string; name: string }>>();
  for (const [f, sf] of sources) {
    const m = new Map<string, { file: string; name: string }>();
    for (const st of sf.statements) {
      if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
      const target = resolveImport(f, st.moduleSpecifier.text);
      const nb = st.importClause?.namedBindings;
      if (target && nb && ts.isNamedImports(nb)) for (const el of nb.elements) m.set(el.name.text, { file: target, name: (el.propertyName ?? el.name).text });
    }
    imports.set(f, m);
  }
  const consts = new Map<string, Map<string, string>>();
  for (const [f, sf] of sources) {
    const m = new Map<string, string>();
    const visit = (n: ts.Node) => {
      if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && (ts.isStringLiteral(n.initializer) || ts.isNoSubstitutionTemplateLiteral(n.initializer))) m.set(n.name.text, n.initializer.text);
      ts.forEachChild(n, visit);
    };
    visit(sf);
    consts.set(f, m);
  }
  const resolveConst = (f: string, name: string): string | undefined => consts.get(f)?.get(name) ?? (imports.get(f)?.get(name) ? consts.get(imports.get(f)!.get(name)!.file)?.get(imports.get(f)!.get(name)!.name) : undefined);

  const values = (f: string, e: ts.Expression | undefined): string[] => {
    if (!e) return [''];
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return [e.text];
    if (ts.isNumericLiteral(e)) return [e.text];
    if (ts.isConditionalExpression(e)) return [...values(f, e.whenTrue), ...values(f, e.whenFalse)];
    if (ts.isParenthesizedExpression(e)) return values(f, e.expression);
    if (ts.isIdentifier(e)) {
      const c = resolveConst(f, e.text);
      if (c !== undefined) return [c];
    }
    if (ts.isTemplateExpression(e)) return [e.head.text + e.templateSpans.map((s) => `*${s.literal.text}`).join('')];
    return ['*'];
  };

  // ── Contexte d'un customId : type de composant ──
  const kindOfNew = (call: ts.CallExpression): Kind => {
    let e: ts.Expression = (call.expression as ts.PropertyAccessExpression).expression;
    for (;;) {
      if (ts.isNewExpression(e)) {
        const name = e.expression.getText();
        if (name === 'ButtonBuilder') return 'button';
        if (name === 'ModalBuilder') return 'modal';
        if (/SelectMenuBuilder$/.test(name)) return 'select';
        return 'unknown';
      }
      if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression)) e = e.expression.expression;
      else if (ts.isPropertyAccessExpression(e) || ts.isParenthesizedExpression(e)) e = e.expression;
      else return 'unknown';
    }
  };
  const contextKind = (node: ts.Node): Kind => {
    const p = node.parent;
    if (p && ts.isCallExpression(p) && p.arguments[0] === node) {
      if (ts.isPropertyAccessExpression(p.expression) && p.expression.name.text === 'setCustomId') return kindOfNew(p);
      if (ts.isIdentifier(p.expression)) {
        if (['btn', 'toggleBtn', 'moduleBtn', 'moduleButton'].includes(p.expression.text)) return 'button';
        if (p.expression.text === 'modal') return 'modal';
      }
    }
    if (p && (ts.isParenthesizedExpression(p) || ts.isConditionalExpression(p))) return contextKind(p);
    return 'unknown';
  };

  // ── Wrappers (fonctions qui construisent un customId à partir de leurs paramètres), jusqu'au point fixe ──
  const wrappers = new Map<string, Map<string, Wrapper>>();
  for (const f of files) wrappers.set(f, new Map());
  const resolveWrapper = (f: string, name: string): Wrapper | undefined => {
    const local = wrappers.get(f)?.get(name);
    if (local) return local;
    const i = imports.get(f)?.get(name);
    return i ? wrappers.get(i.file)?.get(i.name) : undefined;
  };
  /** Arguments (ns, action, sub) d'un appel buildCustomId ou d'un appel de wrapper connu. */
  const callSlots = (f: string, call: ts.CallExpression): { ns: ts.Expression | Slot; action: ts.Expression | Slot; sub: ts.Expression | Slot; kind: Kind } | null => {
    if (!ts.isIdentifier(call.expression)) return null;
    if (call.expression.text === 'buildCustomId') return { ns: call.arguments[0] ?? null, action: call.arguments[1] ?? null, sub: call.arguments[2] ?? null, kind: contextKind(call) };
    const w = resolveWrapper(f, call.expression.text);
    if (!w) return null;
    const pick = (s: Slot): ts.Expression | Slot => (s && 'param' in s ? (call.arguments[s.param] ?? null) : s);
    return { ns: pick(w.ns), action: pick(w.action), sub: pick(w.sub), kind: w.kind !== 'unknown' ? w.kind : contextKind(call) };
  };
  const isExpr = (x: unknown): x is ts.Expression => !!x && typeof x === 'object' && 'kind' in (x as object) && typeof (x as { kind: unknown }).kind === 'number';
  let changed = true;
  while (changed) {
    changed = false;
    for (const [f, sf] of sources) {
      const consider = (name: string, fn: ts.SignatureDeclaration & { body?: ts.Node }) => {
        if (!fn.body || wrappers.get(f)!.has(name)) return;
        const params = fn.parameters.map((p) => (ts.isIdentifier(p.name) ? p.name.text : ''));
        const toSlot = (x: ts.Expression | Slot): Slot | undefined => {
          if (!isExpr(x)) return x;
          if (ts.isIdentifier(x) && params.includes(x.text)) return { param: params.indexOf(x.text) };
          if (ts.isSpreadElement(x) && ts.isIdentifier(x.expression) && params.includes(x.expression.text)) return { param: params.indexOf(x.expression.text) };
          const v = values(f, x);
          return v.includes('*') ? undefined : { lit: v };
        };
        let found: Wrapper | null = null;
        const visit = (n: ts.Node) => {
          if (found) return;
          if (ts.isCallExpression(n)) {
            const slots = callSlots(f, n);
            if (slots) {
              const ns = toSlot(slots.ns);
              const action = toSlot(slots.action);
              const sub = toSlot(slots.sub);
              const usesParam = [ns, action, sub].some((s) => s && 'param' in s);
              if (ns && usesParam) found = { ns, action: action ?? null, sub: sub ?? null, kind: slots.kind };
            }
          }
          ts.forEachChild(n, visit);
        };
        visit(fn.body);
        if (found) {
          wrappers.get(f)!.set(name, found);
          changed = true;
        }
      };
      const visit = (n: ts.Node) => {
        if (ts.isFunctionDeclaration(n) && n.name) consider(n.name.text, n);
        if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) consider(n.name.text, n.initializer);
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
  }

  // ── Sites de génération ──
  const gens: Gen[] = [];
  for (const [f, sf] of sources) {
    const visit = (n: ts.Node, inWrapper: boolean) => {
      if (!inWrapper && ts.isCallExpression(n)) {
        const slots = callSlots(f, n);
        if (slots) {
          const vals = (x: ts.Expression | Slot): string[] => (isExpr(x) ? values(f, x) : x && 'lit' in x ? x.lit : x ? ['*'] : ['']);
          const line = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
          for (const ns of vals(slots.ns)) gens.push({ file: f, line, ns, actions: vals(slots.action), subs: vals(slots.sub), kind: slots.kind, text: n.getText().replace(/\s+/g, ' ').slice(0, 90) });
        }
      }
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'setCustomId') {
        const a = n.arguments[0];
        if (a && ts.isStringLiteral(a) && a.text.includes(':')) {
          const [ns = '', action = '', sub = ''] = a.text.split(':');
          gens.push({ file: f, line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1, ns, actions: [action], subs: [sub], kind: kindOfNew(n), text: a.text });
        }
      }
      const isWrapperDecl = (ts.isFunctionDeclaration(n) && n.name && wrappers.get(f)!.has(n.name.text)) || (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && wrappers.get(f)!.has(n.name.text));
      ts.forEachChild(n, (c) => visit(c, inWrapper || !!isWrapperDecl));
    };
    visit(sf, false);
  }

  // ── Handlers ──
  const handlers: Handler[] = [];
  const dirKind: Record<string, Kind> = { buttons: 'button', selectMenus: 'select', modals: 'modal' };
  for (const [dir, kind] of Object.entries(dirKind)) {
    for (const f of files.filter((x) => x.startsWith(path.join(SRC, dir) + path.sep) && !path.basename(x).startsWith('_'))) {
      const sf = sources.get(f)!;
      const h: Handler = { file: f, kind, id: '', handled: new Set(), declared: new Map(), permissions: '' };
      const declare = (v: string, n: ts.Node) => {
        h.declared.set(v, sf.getLineAndCharacterOfPosition(n.getStart()).line + 1);
        h.handled.add(v);
      };
      const visit = (n: ts.Node) => {
        if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && /^define(Button|SelectMenu|Modal)$/.test(n.expression.text) && n.arguments[0] && ts.isObjectLiteralExpression(n.arguments[0])) {
          for (const p of n.arguments[0].properties) {
            if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name)) continue;
            if (p.name.text === 'id') h.id = values(f, p.initializer)[0]!;
            if (p.name.text === 'permissions') h.permissions = p.initializer.getText().replace(/\s+/g, ' ');
          }
        }
        if (ts.isSwitchStatement(n) && ts.isIdentifier(n.expression) && ACTION_VARS.has(n.expression.text)) {
          for (const c of n.caseBlock.clauses) if (ts.isCaseClause(c) && (ts.isStringLiteral(c.expression) || ts.isNoSubstitutionTemplateLiteral(c.expression))) declare(c.expression.text, c);
        }
        if (ts.isCaseClause(n) && ts.isStringLiteral(n.expression)) h.handled.add(n.expression.text);
        if (ts.isBinaryExpression(n) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(n.operatorToken.kind)) {
          const [l, r] = [n.left, n.right];
          for (const [a, b] of [
            [l, r],
            [r, l],
          ] as const) {
            if (ts.isStringLiteral(b)) {
              if (ts.isIdentifier(a) && ACTION_VARS.has(a.text)) declare(b.text, n);
              else h.handled.add(b.text);
            }
          }
        }
        if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
          if (n.name.text === 'handlers' && ts.isObjectLiteralExpression(n.initializer)) {
            for (const p of n.initializer.properties) if ((ts.isMethodDeclaration(p) || ts.isPropertyAssignment(p)) && p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) declare(p.name.text, p);
          }
          if (/ACTIONS$/.test(n.name.text) && ts.isArrayLiteralExpression(n.initializer)) for (const el of n.initializer.elements) if (ts.isStringLiteral(el)) declare(el.text, el);
        }
        if (ts.isArrayLiteralExpression(n)) for (const el of n.elements) if (ts.isStringLiteral(el)) h.handled.add(el.text);
        // action.match(/^(a|b)-x$/)
        if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'match' && ts.isIdentifier(n.expression.expression) && ACTION_VARS.has(n.expression.expression.text)) {
          const re = n.arguments[0];
          if (re && re.kind === ts.SyntaxKind.RegularExpressionLiteral) {
            const m = re.getText().replace(/^\/|\/[a-z]*$/g, '').match(/^\^\(([^)]+)\)(.*)\$$/);
            if (m) for (const alt of m[1]!.split('|')) declare(alt + m[2]!.replace(/\\/g, ''), n);
          }
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
      handlers.push(h);
    }
  }

  // ── Comparaison ──
  const match = (pattern: string, lit: string): boolean => {
    if (!pattern.includes('*')) return pattern === lit;
    return new RegExp(`^${pattern.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.+')}$`).test(lit);
  };
  const fits = (g: Gen, h: Handler) => g.ns === h.id && (g.kind === 'unknown' || g.kind === h.kind);
  let dynamicSites = 0;
  for (const g of gens) {
    if (RESERVED.has(g.ns) || g.ns === '*') continue;
    const cands = handlers.filter((h) => fits(g, h));
    if (!cands.length) {
      problems.push(`aucun handler ${g.kind} pour « ${g.ns} » — ${rel(g.file)}:${g.line} ${g.text}`);
      continue;
    }
    for (const a of g.actions) {
      if (a === '*') {
        dynamicSites++;
        notes.push(`action dynamique ${g.ns}:* (${g.kind}) — ${rel(g.file)}:${g.line} ${g.text}`);
        continue;
      }
      if (DEFAULT_BRANCH.has(`${g.ns}:${a}`)) continue;
      if (!cands.some((h) => [...h.handled].some((l) => match(a, l)))) problems.push(`action non traitée ${g.ns}:${a} (${g.kind}) — ${rel(g.file)}:${g.line} ${g.text} [${cands.map((c) => rel(c.file)).join(', ')}]`);
    }
  }
  for (const h of handlers) {
    const mine = gens.filter((g) => fits(g, h));
    if (!mine.length) {
      problems.push(`handler jamais atteint : ${h.kind} « ${h.id} » (${rel(h.file)}) — aucun customId généré`);
      continue;
    }
    const generated = mine.flatMap((g) => [...g.actions, ...g.subs]);
    for (const [action, line] of h.declared) {
      if (!generated.some((g) => match(g, action))) problems.push(`action déclarée jamais générée : ${h.id}:${action} — ${rel(h.file)}:${line}`);
    }
    if (isConfigNamespace(h.id) && !/internal:\s*'admin'/.test(h.permissions)) problems.push(`permissions de configuration sans internal: 'admin' — ${rel(h.file)} (${h.permissions || 'aucune'})`);
  }
  return {
    name: 'customIds ⇄ handlers',
    problems,
    notes,
    summary: `${gens.length} sites de génération, ${handlers.length} handlers (${handlers.reduce((n, h) => n + h.declared.size, 0)} actions déclarées), ${dynamicSites} action(s) dynamique(s) vérifiée(s) à la main, ${problems.length} écart(s)`,
  };
}

if (require.main === module) void runStandalone(run);
