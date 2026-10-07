import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { ROOT, rel, runStandalone, type CheckResult } from './_lib';

/**
 * Clés de traduction.
 *  - chaque `t('…')` littéral (et chaque clé dynamique dont le type est une union de littéraux) existe en fr ET en en ;
 *  - chaque préfixe dynamique (`t(\`tickets.status.${s}\`)`) correspond à au moins une clé ;
 *  - chaque code des erreurs métier (`new TicketError('code')`…) a sa traduction `<module>.errors.<code>` ;
 *  - les littéraux « clé » passés à des helpers (`replyError(…, 'moderation.x')`, `new PanelError('…')`) existent ;
 *  - parité fr / en (mêmes clés, mêmes variables `{x}`).
 */

const LOCALES = path.join(ROOT, 'src', 'locales');
const ERROR_PREFIXES: Record<string, string> = {
  TicketError: 'tickets.errors',
  WhitelistError: 'whitelist.errors',
  ShopError: 'shop.errors',
  SchoolError: 'school.errors',
  BattleRoyaleError: 'battleroyale.errors',
  FiveMError: 'fivem.errors',
  AnnouncementError: 'announcements.errors',
  EmbedTemplateError: 'embeds.errors',
};
/** Propriétés dont la valeur est un identifiant technique (action de log…), pas une clé. */
const NON_KEY_PROPS = new Set(['action', 'name', 'event', 'category']);

function flatten(tree: Record<string, unknown>, prefix: string, out: Map<string, string>): void {
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out.set(key, v);
    else if (v && typeof v === 'object') flatten(v as Record<string, unknown>, key, out);
  }
}

export async function run(): Promise<CheckResult> {
  const problems: string[] = [];
  const notes: string[] = [];
  const langs: Record<'fr' | 'en', Map<string, string>> = { fr: new Map(), en: new Map() };
  for (const lang of ['fr', 'en'] as const) {
    for (const f of fs.readdirSync(path.join(LOCALES, lang)).filter((x) => x.endsWith('.json'))) {
      flatten(JSON.parse(fs.readFileSync(path.join(LOCALES, lang, f), 'utf8')) as Record<string, unknown>, f.replace('.json', ''), langs[lang]);
    }
  }
  const namespaces = new Set([...langs.fr.keys()].map((k) => k.split('.')[0]!));
  const allKeys = [...langs.fr.keys()];

  const cfg = ts.readConfigFile(path.join(ROOT, 'tsconfig.json'), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, ROOT);
  const srcDir = path.join(ROOT, 'src') + path.sep;
  const program = ts.createProgram(
    parsed.fileNames.filter((f) => f.startsWith(srcDir)),
    { ...parsed.options, noEmit: true },
  );
  const checker = program.getTypeChecker();
  const where = (sf: ts.SourceFile, n: ts.Node) => `${rel(sf.fileName)}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;

  const used = new Set<string>();
  const usedPatterns: RegExp[] = [];
  const seenProblems = new Set<string>();
  const problem = (msg: string) => {
    if (!seenProblems.has(msg)) {
      seenProblems.add(msg);
      problems.push(msg);
    }
  };
  const requireKey = (key: string, origin: string, at: string) => {
    used.add(key);
    for (const lang of ['fr', 'en'] as const) if (!langs[lang].has(key)) problem(`[${lang}] clé absente « ${key} » (${origin}) — ${at}`);
  };

  const literalUnion = (type: ts.Type): string[] | null => {
    if (type.isStringLiteral()) return [type.value];
    if (!type.isUnion()) return null;
    const out: string[] = [];
    for (const t of type.types) {
      if (t.isStringLiteral()) out.push(t.value);
      else if (!(t.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null))) return null;
    }
    return out;
  };
  /** Valeurs possibles d'une expression de clé ; `pattern` si partiellement dynamique. */
  const keyValues = (e: ts.Expression): { values: string[] | null; pattern?: string } => {
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return { values: [e.text] };
    if (ts.isParenthesizedExpression(e)) return keyValues(e.expression);
    if (ts.isConditionalExpression(e) || (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) {
      const [x, y] = ts.isConditionalExpression(e) ? [e.whenTrue, e.whenFalse] : [e.left, e.right];
      const a = keyValues(x);
      const b = keyValues(y);
      if (a.values && b.values) return { values: [...a.values, ...b.values] };
    }
    if (ts.isTemplateExpression(e)) {
      let combos = [e.head.text];
      let pattern = e.head.text;
      let resolved = true;
      for (const span of e.templateSpans) {
        const vals = literalUnion(checker.getTypeAtLocation(span.expression));
        pattern += `\u0000${span.literal.text}`;
        if (!vals || vals.length > 200) resolved = false;
        else combos = combos.flatMap((c) => vals.map((v) => c + v + span.literal.text));
      }
      return resolved ? { values: combos } : { values: null, pattern };
    }
    const vals = literalUnion(checker.getTypeAtLocation(e));
    return vals ? { values: vals } : { values: null };
  };
  let dynamicCount = 0;
  const checkKeyExpr = (sf: ts.SourceFile, node: ts.Node, e: ts.Expression, origin: string) => {
    const { values, pattern } = keyValues(e);
    if (values) {
      for (const k of values) requireKey(k, origin, where(sf, node));
      return;
    }
    if (!pattern) {
      notes.push(`clé variable non résolue statiquement : ${e.getText()} — ${where(sf, node)}`);
      return;
    }
    dynamicCount++;
    const parts = pattern.split('\u0000');
    const re = new RegExp(`^${parts.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^]+')}$`);
    usedPatterns.push(re);
    const n = allKeys.filter((k) => re.test(k)).length;
    if (!n) problem(`préfixe dynamique sans aucune clé : ${pattern.replace(/\u0000/g, '${…}')} — ${where(sf, node)}`);
  };
  const isNonKeyContext = (n: ts.Node): boolean => {
    // Nom de propriété d'un objet (`{ 'fivem.sync.ban': 'fivem.sync' }`, table des routes de logs) : jamais une clé passée à t()
    if (n.parent && ts.isPropertyAssignment(n.parent) && n.parent.name === n) return true;
    let p = n.parent;
    while (p && (ts.isConditionalExpression(p) || ts.isParenthesizedExpression(p) || ts.isBinaryExpression(p))) p = p.parent;
    return !!p && ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && NON_KEY_PROPS.has(p.name.text);
  };

  for (const sf of program.getSourceFiles()) {
    if (!sf.fileName.startsWith(srcDir)) continue;
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n)) {
        const c = n.expression;
        const isT = (ts.isIdentifier(c) && c.text === 't') || (ts.isPropertyAccessExpression(c) && c.name.text === 't' && c.expression.kind !== ts.SyntaxKind.ThisKeyword);
        if (isT && n.arguments[0]) checkKeyExpr(sf, n, n.arguments[0], 't()');
        else if (ts.isPropertyAccessExpression(c) && c.name.text === 'translate' && n.arguments[1]) checkKeyExpr(sf, n, n.arguments[1], 'translate()');
      }
      if (ts.isNewExpression(n) && n.arguments?.[0]) {
        const cls = n.expression.getText();
        if (cls === 'PanelError' || cls === 'ModerationError') checkKeyExpr(sf, n, n.arguments[0], cls);
        const prefix = ERROR_PREFIXES[cls];
        if (prefix) {
          const { values } = keyValues(n.arguments[0]);
          if (values) for (const v of values) requireKey(`${prefix}.${v}`, `code ${cls}`, where(sf, n));
          else notes.push(`code ${cls} non résolu : ${n.arguments[0].getText()} — ${where(sf, n)}`);
        }
      }
      // Littéral « clé » passé ailleurs (helpers, notices, tableaux de clés)
      const looksLikeKey = (s: string) => /^[a-z_]+\.[a-zA-Z0-9_.-]+$/.test(s) && !/\.(png|jpe?g|gif|webp|json|html|txt|pdf|zip)$/i.test(s) && namespaces.has(s.split('.')[0]!);
      if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && looksLikeKey(n.text)) {
        const parent = n.parent;
        const isImport = parent && (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent));
        if (!isImport && !isNonKeyContext(n) && !langs.fr.has(n.text) && !allKeys.some((k) => k.startsWith(`${n.text}.`))) problem(`littéral de clé introuvable « ${n.text} » — ${where(sf, n)}`);
        else used.add(n.text);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }

  for (const k of langs.fr.keys()) if (!langs.en.has(k)) problem(`parité : « ${k} » absente de en`);
  for (const k of langs.en.keys()) if (!langs.fr.has(k)) problem(`parité : « ${k} » absente de fr`);
  const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  for (const [k, fr] of langs.fr) {
    const en = langs.en.get(k);
    if (en !== undefined && vars(fr) !== vars(en)) problem(`variables différentes fr/en pour « ${k} » : fr{${vars(fr)}} en{${vars(en)}}`);
  }
  const unused = allKeys.filter((k) => !used.has(k) && !usedPatterns.some((re) => re.test(k)) && ![...used].some((u) => k.startsWith(`${u}.`)));
  if (unused.length) notes.push(`${unused.length} clé(s) sans référence statique (utilisées via variables ou mortes) : ${unused.slice(0, 15).join(', ')}${unused.length > 15 ? '…' : ''}`);

  return {
    name: 'Clés de traduction (fr / en)',
    problems,
    notes,
    summary: `${langs.fr.size} clés fr / ${langs.en.size} en, ${used.size} références littérales, ${dynamicCount} préfixes dynamiques, ${problems.length} écart(s)`,
  };
}

if (require.main === module) void runStandalone(run);
