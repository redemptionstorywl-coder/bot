import path from 'node:path';
import ts from 'typescript';
import { ACTION_ROUTES } from '../../src/services/logs/routes';
import { ROOT, rel, runStandalone, type CheckResult } from './_lib';

/**
 * Actions de logs ⇄ routes du serveur de logs central (src/services/logs/routes.ts) :
 *  - chaque `action` passée à `loggingService.log({...})` (src/ et dashboard/) est résolue statiquement (littéral, ternaire,
 *    gabarit dont les parties dynamiques ont un type union de littéraux — `x.toLowerCase()` d'une union compris —, variable
 *    typée par une union) ; chaque valeur doit figurer dans ACTION_ROUTES ;
 *  - une action non résoluble statiquement est une erreur (typer la variable par une union de littéraux) ;
 *  - idem pour les événements « bot » envoyés aux hubs (`logHubService.system(client, 'bot.x', …)`).
 */

export interface ResolvedActions {
  values: string[];
  unresolved: string | null;
}

export async function collectActions(): Promise<{ sites: { where: string; values: string[]; unresolved: string | null }[] }> {
  const cfg = ts.readConfigFile(path.join(ROOT, 'tsconfig.json'), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, ROOT);
  const dirs = [path.join(ROOT, 'src') + path.sep, path.join(ROOT, 'dashboard') + path.sep];
  const program = ts.createProgram(
    parsed.fileNames.filter((f) => dirs.some((d) => f.startsWith(d))),
    { ...parsed.options, noEmit: true },
  );
  const checker = program.getTypeChecker();

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
  const spanValues = (e: ts.Expression): string[] | null => {
    // `x.toLowerCase()` d'une union de littéraux (enum Prisma, union Zod…)
    if (ts.isCallExpression(e) && ts.isPropertyAccessExpression(e.expression) && e.expression.name.text === 'toLowerCase' && !e.arguments.length) {
      const inner = literalUnion(checker.getTypeAtLocation(e.expression.expression));
      return inner ? inner.map((v) => v.toLowerCase()) : null;
    }
    return literalUnion(checker.getTypeAtLocation(e));
  };
  const values = (e: ts.Expression): ResolvedActions => {
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return { values: [e.text], unresolved: null };
    if (ts.isParenthesizedExpression(e)) return values(e.expression);
    if (ts.isConditionalExpression(e)) {
      const a = values(e.whenTrue);
      const b = values(e.whenFalse);
      return { values: [...a.values, ...b.values], unresolved: a.unresolved ?? b.unresolved };
    }
    if (ts.isTemplateExpression(e)) {
      let combos = [e.head.text];
      for (const span of e.templateSpans) {
        const vals = spanValues(span.expression);
        if (!vals) return { values: [], unresolved: e.getText() };
        combos = combos.flatMap((c) => vals.map((v) => c + v + span.literal.text));
      }
      return { values: combos, unresolved: null };
    }
    const vals = literalUnion(checker.getTypeAtLocation(e));
    return vals ? { values: vals, unresolved: null } : { values: [], unresolved: e.getText() };
  };

  const sites: { where: string; values: string[]; unresolved: string | null }[] = [];
  for (const sf of program.getSourceFiles()) {
    if (!dirs.some((d) => sf.fileName.startsWith(d)) || sf.fileName.endsWith('.d.ts')) continue;
    const where = (n: ts.Node) => `${rel(sf.fileName)}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
        const target = n.expression.expression.getText();
        const method = n.expression.name.text;
        if (target === 'loggingService' && method === 'log' && n.arguments[0] && ts.isObjectLiteralExpression(n.arguments[0])) {
          const prop = n.arguments[0].properties.find((p) => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name && ts.isIdentifier(p.name) && p.name.text === 'action');
          if (!prop) sites.push({ where: where(n), values: [], unresolved: '(action absente)' });
          else {
            const expr = ts.isPropertyAssignment(prop) ? prop.initializer : (prop as ts.ShorthandPropertyAssignment).name;
            sites.push({ where: where(n), ...values(expr) });
          }
        }
        if (target === 'logHubService' && method === 'system' && n.arguments[1]) sites.push({ where: where(n), ...values(n.arguments[1]) });
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  return { sites };
}

export async function run(): Promise<CheckResult> {
  const problems: string[] = [];
  const notes: string[] = [];
  const { sites } = await collectActions();
  const used = new Set<string>();
  for (const site of sites) {
    if (site.unresolved) problems.push(`action non résoluble statiquement « ${site.unresolved} » — ${site.where} (typer par une union de littéraux)`);
    for (const v of site.values) {
      used.add(v);
      if (!ACTION_ROUTES[v]) problems.push(`action « ${v} » sans route dans ACTION_ROUTES (src/services/logs/routes.ts) — ${site.where}`);
    }
  }
  const unused = Object.keys(ACTION_ROUTES).filter((a) => !used.has(a));
  if (unused.length) notes.push(`routes sans appel loggingService.log direct : ${unused.join(', ')}`);
  return { name: 'Actions de logs ⇄ routes du hub', problems, notes, summary: `${sites.length} appels, ${used.size} actions, ${problems.length} écart(s)` };
}

if (require.main === module) void runStandalone(run);
