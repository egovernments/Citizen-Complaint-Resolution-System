/**
 * Build catalog.json from a Playwright JSON report + the spec files on disk.
 *
 * Inputs:
 *   - report.json (Playwright JSON reporter output, written next to playwright.config.ts)
 *   - history.json (rolling 5-run history per test; created on first run if absent)
 *   - tests/**\/*.spec.ts (source-of-truth for tag + source code per test)
 *
 * Outputs:
 *   - catalog.json (consumed by dashboard SPA)
 *   - history.json (updated with the new run prepended; trimmed to 5 entries)
 *
 * Run:
 *   node --import tsx/esm scripts/build-catalog.ts <runId>
 *   or:
 *   npx tsx scripts/build-catalog.ts <runId>
 *
 * The runId is the directory name under runs/ on the host. Format is
 * YYYY-MM-DD_HHMM_<short-sha> by convention but the script doesn't enforce.
 */
import { Project, Node, SyntaxKind, CallExpression } from 'ts-morph';
import * as fs from 'fs';
import * as path from 'path';

const HISTORY_LIMIT = 5;

type TestStatus = 'passed' | 'failed' | 'skipped' | 'timedOut' | 'interrupted';

interface CatalogTest {
  id: string;
  title: string;
  describe: string;
  file: string;
  line: number;
  tags: string[];
  description: string | null;
  source: string;
  lastStatus: TestStatus | null;
  lastDurationMs: number | null;
  history: HistoryEntry[];
  latestRun: LatestRun | null;
  parseError: string | null;
}

interface HistoryEntry {
  runId: string;
  status: TestStatus;
  durationMs: number;
}

interface LatestRun {
  runId: string;
  videoUrl: string | null;
  traceUrl: string | null;
  screenshotUrls: string[];
  errorMessage: string | null;
  errorStack: string | null;
}

interface RunSummary {
  id: string;
  startedAt: string;
  durationMs: number;
  passed: number;
  failed: number;
  skipped: number;
  timedOut: number;
  total: number;
  sha: string;
  branch: string;
  baseUrl: string;
}

interface Catalog {
  generatedAt: string;
  lastRunId: string;
  tagFacets: Record<string, string[]>;
  tests: CatalogTest[];
  runs: RunSummary[];
}

interface HistoryFile {
  perTest: Record<string, HistoryEntry[]>;
  runs: RunSummary[];
}

// ---------------------------------------------------------------------------
// AST walk: collect every test() call from disk + its tags + source text.
// ---------------------------------------------------------------------------

interface AstTestRecord {
  id: string;            // matches Playwright's test id format: file:line:title
  title: string;
  describe: string;
  file: string;          // relative to repo root
  line: number;          // 1-based
  tags: string[];
  description: string | null;  // hand-written, from annotation.description
  source: string;
  parseError: string | null;
}

function collectFromAst(): AstTestRecord[] {
  const project = new Project({
    tsConfigFilePath: 'tsconfig.json',
    skipAddingFilesFromTsConfig: true,
  });
  project.addSourceFilesAtPaths('tests/**/*.spec.ts');

  const out: AstTestRecord[] = [];

  for (const sf of project.getSourceFiles()) {
    const filePath = path.relative(process.cwd(), sf.getFilePath()).replace(/\\/g, '/');

    function walk(node: Node, describeStack: string[]): void {
      if (Node.isCallExpression(node)) {
        const expr = node.getExpression().getText();
        if (/^test\.describe(\.serial|\.parallel|\.only|\.skip)?$/.test(expr)) {
          const args = node.getArguments();
          if (args.length >= 2 && Node.isStringLiteral(args[0])) {
            const title = args[0].getLiteralText();
            const fnArg = args[args.length - 1];
            if (Node.isArrowFunction(fnArg) || Node.isFunctionExpression(fnArg)) {
              const body = fnArg.getBody();
              body.forEachChild(c => walk(c, [...describeStack, title]));
              return;
            }
          }
        }
        if (/^test(\.skip|\.only|\.fixme|\.slow|\.step)?$/.test(expr)) {
          const args = node.getArguments();
          if (args.length >= 1 && Node.isStringLiteral(args[0])) {
            const title = args[0].getLiteralText();
            const line = sf.getLineAndColumnAtPos(node.getStart()).line;
            const tags = extractTags(node);
            const description = extractDescription(node);
            const source = node.getText();
            out.push({
              id: `${filePath}:${line}:${title}`,
              title,
              describe: describeStack.join(' › '),
              file: filePath,
              line,
              tags,
              description,
              source,
              parseError: null,
            });
            return;
          }
        }
      }
      node.forEachChild(c => walk(c, describeStack));
    }
    sf.forEachChild(c => walk(c, []));
  }
  return out;
}

/**
 * Pull the hand-written annotation.description out of:
 *   test('title', { annotation: { type: 'description', description: `…` }, tag: [...] }, fn)
 * Returns null if the annotation isn't present (test not yet documented).
 * Handles both single-annotation object form and array form.
 */
function extractDescription(call: CallExpression): string | null {
  const args = call.getArguments();
  if (args.length < 2) return null;
  const second = args[1];
  if (!Node.isObjectLiteralExpression(second)) return null;
  const annotationProp = second.getProperty('annotation');
  if (!annotationProp || !Node.isPropertyAssignment(annotationProp)) return null;
  const init = annotationProp.getInitializer();
  if (!init) return null;

  const readDescriptionFromObject = (obj: Node): string | null => {
    if (!Node.isObjectLiteralExpression(obj)) return null;
    const descProp = obj.getProperty('description');
    if (!descProp || !Node.isPropertyAssignment(descProp)) return null;
    const descInit = descProp.getInitializer();
    if (!descInit) return null;
    // Strip the surrounding quote/backtick. ts-morph's getLiteralText handles
    // template literals, regular strings, and concatenations cleanly enough
    // for our case where it's always a single template literal.
    if (Node.isStringLiteral(descInit) || Node.isNoSubstitutionTemplateLiteral(descInit)) {
      return descInit.getLiteralText();
    }
    // Fallback: strip backticks/quotes manually so we don't lose pure-text
    // template literals if ts-morph misclassifies.
    const text = descInit.getText();
    return text.replace(/^[`'"]|[`'"]$/g, '');
  };

  if (Node.isObjectLiteralExpression(init)) return readDescriptionFromObject(init);
  if (Node.isArrayLiteralExpression(init)) {
    for (const el of init.getElements()) {
      const d = readDescriptionFromObject(el);
      if (d) return d;
    }
  }
  return null;
}

function extractTags(call: CallExpression): string[] {
  const args = call.getArguments();
  if (args.length < 2) return [];
  const second = args[1];
  if (!Node.isObjectLiteralExpression(second)) return [];
  const tagProp = second.getProperty('tag');
  if (!tagProp || !Node.isPropertyAssignment(tagProp)) return [];
  const init = tagProp.getInitializer();
  if (!init || !Node.isArrayLiteralExpression(init)) return [];
  return init.getElements()
    .map(e => e.getText().trim())
    .map(t => t.replace(/^['"`]|['"`]$/g, ''));
}

// ---------------------------------------------------------------------------
// Playwright JSON report ingest.
// ---------------------------------------------------------------------------

interface PwReport {
  config: { rootDir: string; projects: Array<{ name: string; outputDir: string }> };
  stats: { startTime: string; duration: number; expected: number; unexpected: number; skipped: number; flaky: number };
  suites: PwSuite[];
}
interface PwSuite {
  title: string;
  file?: string;
  suites?: PwSuite[];
  specs?: PwSpec[];
}
interface PwSpec {
  title: string;
  file: string;
  line: number;
  column: number;
  tags?: string[];
  tests?: PwTest[];
}
interface PwTest {
  status: TestStatus;
  results: PwResult[];
}
interface PwResult {
  status: TestStatus;
  duration: number;
  error?: { message?: string; stack?: string };
  attachments?: Array<{ name: string; path?: string; contentType: string }>;
}

function flattenSpecs(report: PwReport): { spec: PwSpec; describePath: string[] }[] {
  const out: { spec: PwSpec; describePath: string[] }[] = [];
  function walk(s: PwSuite, describePath: string[]): void {
    const nextPath = [...describePath];
    if (s.title && !s.file) nextPath.push(s.title);
    for (const spec of s.specs || []) {
      out.push({ spec, describePath: nextPath });
    }
    for (const child of s.suites || []) walk(child, nextPath);
  }
  for (const top of report.suites) walk(top, []);
  return out;
}

// ---------------------------------------------------------------------------
// Map Playwright attachment paths to URLs under /tests/runs/<runId>/.
// Playwright JSON gives absolute paths inside test-results/.
// We rewrite to a relative URL path that nginx will serve.
// ---------------------------------------------------------------------------

function attachmentUrl(absPath: string, runId: string): string {
  // Playwright writes attachments under <repo>/test-results/ or
  // <repo>/playwright-report/data/. We publish each verbatim under
  // runs/<runId>/. Build the URL by extracting the path starting at the
  // first occurrence of one of those known prefixes — this works whether
  // build-catalog runs on the runner (cwd = repo) or somewhere else
  // (e.g. recovering an old report from the host).
  const norm = absPath.replace(/\\/g, '/');
  for (const prefix of ['test-results/', 'playwright-report/']) {
    const idx = norm.indexOf('/' + prefix);
    if (idx >= 0) return `runs/${runId}/${norm.slice(idx + 1)}`;
    if (norm.startsWith(prefix)) return `runs/${runId}/${norm}`;
  }
  // Fallback: relative-from-cwd as before. URLs may still be valid when
  // running on the runner, but get caught by reviewers if not.
  const rel = path.relative(process.cwd(), absPath).replace(/\\/g, '/');
  return `runs/${runId}/${rel}`;
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

interface BuildOptions {
  runId: string;
  reportPath: string;
  historyPath: string;
  catalogPath: string;
  publicHistoryPath: string | null; // optional pre-existing history.json from host
  publicCatalogPath: string | null; // optional pre-existing catalog.json from host
  baseUrl: string;
  branch: string;
  sha: string;
}

function readPriorCatalog(p: string | null): Map<string, CatalogTest> {
  const out = new Map<string, CatalogTest>();
  if (!p || !fs.existsSync(p)) return out;
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8')) as Catalog;
    for (const t of parsed.tests || []) out.set(t.id, t);
  } catch (e) {
    console.warn(`[build-catalog] could not parse prior catalog at ${p}: ${(e as Error).message}`);
  }
  return out;
}

function readHistory(p: string | null): HistoryFile {
  if (!p || !fs.existsSync(p)) return { perTest: {}, runs: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8')) as HistoryFile;
    return {
      perTest: parsed.perTest || {},
      runs: Array.isArray(parsed.runs) ? parsed.runs : [],
    };
  } catch (e) {
    console.warn(`[build-catalog] could not parse history at ${p}: ${(e as Error).message}`);
    return { perTest: {}, runs: [] };
  }
}

function buildCatalog(opts: BuildOptions): { catalog: Catalog; nextHistory: HistoryFile } {
  if (!fs.existsSync(opts.reportPath)) {
    throw new Error(`report.json not found at ${opts.reportPath}`);
  }
  const report = JSON.parse(fs.readFileSync(opts.reportPath, 'utf8')) as PwReport;
  const ast = collectFromAst();
  const astById = new Map(ast.map(r => [r.id, r]));

  const flat = flattenSpecs(report);
  const seenIds = new Set<string>();

  // Build per-test latestRun map keyed by id.
  // Playwright's JSON reporter emits spec.file relative to config.rootDir
  // (= testDir, e.g. `<repo>/tests`), so it lacks the `tests/` prefix that
  // the AST ids carry. Older versions emitted absolute paths. Resolve against
  // rootDir first so both shapes normalize to the same cwd-relative id the
  // AST produces — otherwise nothing matches and every lastStatus is null.
  const reportRootDir = report.config?.rootDir || process.cwd();
  const latestById = new Map<string, { test: PwTest; result: PwResult; spec: PwSpec; describePath: string[] }>();
  for (const { spec, describePath } of flat) {
    const absFile = path.isAbsolute(spec.file) ? spec.file : path.resolve(reportRootDir, spec.file);
    const file = path.relative(process.cwd(), absFile).replace(/\\/g, '/');
    const id = `${file}:${spec.line}:${spec.title}`;
    const t = (spec.tests || [])[0];
    if (!t) continue;
    const r = (t.results || [])[t.results.length - 1];
    if (!r) continue;
    latestById.set(id, { test: t, result: r, spec, describePath });
  }

  const oldHistory = readHistory(opts.publicHistoryPath ?? opts.historyPath);
  const priorCatalog = readPriorCatalog(opts.publicCatalogPath ?? null);

  // The runs/ folders on disk are the source of truth for what the dashboard
  // can actually open. In the local-serve model the published history/catalog
  // live in the webroot next to runs/, so drop any prior-history run whose
  // runs/<id>/ folder no longer exists — otherwise a folder that an earlier
  // cycle pruned (or that a failed-no-report run occupied without ever writing
  // a report/catalog entry) leaves the catalog pointing at a 404, and the
  // reportless-but-newer folder that evicted it stays invisible (#907 skew).
  // Only trust disk when the runs are actually local (the current run's own
  // folder is present); the CI rsync model publishes runs elsewhere, so there
  // we keep the old purely-logical window and this stays a no-op.
  const runsDir = opts.publicHistoryPath
    ? path.join(path.dirname(opts.publicHistoryPath), 'runs')
    : null;
  const runsAreLocal = !!runsDir && fs.existsSync(path.join(runsDir, opts.runId));
  const runExists = (id: string): boolean =>
    !runsAreLocal || fs.existsSync(path.join(runsDir!, id));
  const priorRuns = oldHistory.runs.filter(r => r.id !== opts.runId && runExists(r.id));

  // Surviving run-id set after this run is published: the current run plus the
  // still-extant prior runs, capped at the rolling window. run-cycle.sh prunes
  // runs/ to exactly this set, so a latestRun pointer into it is guaranteed
  // reachable; pointers to anything else are dropped below.
  const survivingRunIds = new Set<string>(
    [opts.runId, ...priorRuns.map(r => r.id)].slice(0, HISTORY_LIMIT)
  );

  // Merge: every test from disk → CatalogTest. Tests that ran get latestRun.
  // Tests that didn't run inherit their last-seen latestRun from the prior
  // catalog if and only if that runId is still in the rolling window.
  const tests: CatalogTest[] = [];
  let preservedCount = 0;
  for (const rec of ast) {
    seenIds.add(rec.id);
    const ran = latestById.get(rec.id);
    let lastStatus: TestStatus | null = null;
    let lastDurationMs: number | null = null;
    let latestRun: LatestRun | null = null;

    if (ran) {
      // Playwright nests two status fields:
      //   test.status   : 'expected' | 'unexpected' | 'flaky' | 'skipped'
      //   result.status : 'passed'   | 'failed'     | 'timedOut' | 'skipped' | 'interrupted'
      // We want the result-level outcome — that's what users mean by "passed".
      lastStatus = ran.result.status;
      lastDurationMs = ran.result.duration;

      const screenshots: string[] = [];
      let videoUrl: string | null = null;
      let traceUrl: string | null = null;
      for (const a of ran.result.attachments || []) {
        if (!a.path) continue;
        const url = attachmentUrl(a.path, opts.runId);
        if (a.contentType === 'video/webm' || /\.webm$/i.test(a.path)) videoUrl = url;
        else if (a.contentType === 'application/zip' || a.name === 'trace' || /trace\.zip$/i.test(a.path)) traceUrl = url;
        else if (/^image\//.test(a.contentType) || /\.png$/i.test(a.path)) screenshots.push(url);
      }

      latestRun = {
        runId: opts.runId,
        videoUrl,
        traceUrl,
        screenshotUrls: screenshots,
        errorMessage: ran.result.error?.message ?? null,
        errorStack: ran.result.error?.stack ?? null,
      };
    } else {
      // Test didn't run this time. Keep the prior latestRun pointer if its
      // referenced runId is still in the rolling window — its video/trace
      // are still on disk under runs/<id>/.
      const prior = priorCatalog.get(rec.id);
      if (prior?.latestRun && survivingRunIds.has(prior.latestRun.runId)) {
        latestRun = prior.latestRun;
        lastStatus = prior.lastStatus;
        lastDurationMs = prior.lastDurationMs;
        preservedCount++;
      }
    }

    // History merge: prepend this run's outcome (if any) to prior history.
    const priorHistory = oldHistory.perTest[rec.id] || [];
    const newHistory: HistoryEntry[] = ran
      ? [{ runId: opts.runId, status: ran.result.status, durationMs: ran.result.duration }, ...priorHistory]
      : priorHistory;
    const trimmedHistory = newHistory.slice(0, HISTORY_LIMIT);

    tests.push({
      id: rec.id,
      title: rec.title,
      describe: rec.describe,
      file: rec.file,
      line: rec.line,
      tags: rec.tags,
      description: rec.description,
      source: rec.source,
      lastStatus,
      lastDurationMs,
      history: trimmedHistory,
      latestRun,
      parseError: rec.parseError,
    });
  }

  // Build tagFacets.
  const facetsMap: Record<string, Set<string>> = {};
  for (const t of tests) {
    for (const tag of t.tags) {
      const m = tag.match(/^@([a-z]+):(.+)$/i);
      if (!m) continue;
      const facet = m[1].toLowerCase();
      const value = m[2];
      (facetsMap[facet] ||= new Set()).add(value);
    }
  }
  const tagFacets: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(facetsMap)) tagFacets[k] = Array.from(v).sort();

  // Run summary (counts derived from disk-truth, not just stats — accounts for did-not-run).
  const passed = tests.filter(t => t.lastStatus === 'passed').length;
  const failed = tests.filter(t => t.lastStatus === 'failed' || t.lastStatus === 'timedOut').length;
  const skipped = tests.filter(t => t.lastStatus === 'skipped').length;
  const total = tests.length;

  const newRun: RunSummary = {
    id: opts.runId,
    startedAt: report.stats?.startTime || new Date().toISOString(),
    durationMs: report.stats?.duration ?? 0,
    passed,
    failed,
    skipped,
    timedOut: tests.filter(t => t.lastStatus === 'timedOut').length,
    total,
    sha: opts.sha,
    branch: opts.branch,
    baseUrl: opts.baseUrl,
  };

  const catalog: Catalog = {
    generatedAt: new Date().toISOString(),
    lastRunId: opts.runId,
    tagFacets,
    tests: tests.sort((a, b) => a.id.localeCompare(b.id)),
    runs: [newRun, ...priorRuns].slice(0, HISTORY_LIMIT),
  };

  // Persist next history.json.
  const nextPerTest: Record<string, HistoryEntry[]> = {};
  for (const t of tests) {
    if (t.history.length) nextPerTest[t.id] = t.history;
  }
  const nextHistory: HistoryFile = { perTest: nextPerTest, runs: catalog.runs };
  return { catalog, nextHistory };
}

function main(): void {
  const runId = process.argv[2];
  if (!runId) {
    console.error('usage: build-catalog.ts <runId>');
    process.exit(1);
  }
  const baseUrl = process.env.BASE_URL || 'https://naipepea.digit.org';
  const branch = process.env.BRANCH || 'main';
  const sha = process.env.GIT_SHA || '';
  const reportPath = process.env.REPORT_JSON || 'report.json';
  const historyPath = process.env.HISTORY_JSON || 'history.json';
  const catalogPath = process.env.CATALOG_JSON || 'catalog.json';
  const publicHistoryPath = process.env.PUBLIC_HISTORY_JSON || null;
  const publicCatalogPath = process.env.PUBLIC_CATALOG_JSON || null;

  const { catalog, nextHistory } = buildCatalog({
    runId, reportPath, historyPath, catalogPath,
    publicHistoryPath, publicCatalogPath, baseUrl, branch, sha,
  });
  fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));
  fs.writeFileSync(historyPath, JSON.stringify(nextHistory, null, 2));
  console.log(`[build-catalog] wrote ${catalogPath} (${catalog.tests.length} tests, ${catalog.runs.length} runs)`);
  console.log(`[build-catalog] wrote ${historyPath}`);
}

if (require.main === module) main();

export { buildCatalog, collectFromAst, extractTags };
