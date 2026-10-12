/**
 * Build catalog.json from a Playwright JSON report + the spec files on disk.
 *
 * Inputs:
 *   - report.json (Playwright JSON reporter output, written next to playwright.config.ts)
 *   - history.json (rolling history: the newest DEFAULT_HISTORY_LIMIT runs, env HISTORY_LIMIT; created on first run if absent)
 *   - tests/**\/*.spec.ts (source-of-truth for tag + source code per test)
 *
 * Outputs:
 *   - catalog.json (consumed by the dashboard SPAs)
 *   - history.json (updated with the new run prepended; trimmed to the same limit)
 *
 * Retention has two tiers (DEFAULT_HISTORY_LIMIT / DEFAULT_REPORT_LIMIT below):
 * results for the newest 30 runs, full reports for the newest RUN_LIMIT of them.
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

/**
 * How many runs history.json and catalog.json remember: the run summaries, and
 * each test's per-run results (its newest entries, as many). The dashboards
 * page through them five at a time. Override with HISTORY_LIMIT=<n>.
 */
const DEFAULT_HISTORY_LIMIT = 30;
/**
 * How many of those runs keep their full report — runs/<id>/ with the
 * Playwright HTML report, videos, traces and run.log. run-cycle.sh and
 * publish.sh prune runs/ to their RUN_LIMIT and pass the same value here, so
 * each run summary's `hasReport` matches what is on disk after the prune.
 * Older runs keep their results but lose the drill-down. Override with RUN_LIMIT=<n>.
 */
const DEFAULT_REPORT_LIMIT = 5;

/** A positive integer from the environment, else the fallback. */
function limitFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    console.warn(`[build-catalog] ignoring ${name}=${raw} (want a positive integer); using ${fallback}`);
    return fallback;
  }
  return n;
}

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
  /** Last KNOWN outcome — may come from an older run; see ranInLatestRun. */
  lastStatus: TestStatus | null;
  lastDurationMs: number | null;
  /**
   * True only when this test produced a verdict in the run this catalog was
   * built from. When false, lastStatus/latestRun are carried over from an
   * earlier run and must not be shown as the current result.
   */
  ranInLatestRun: boolean;
  /**
   * True when the run this catalog was built from never planned this test: the
   * Playwright config or command line filtered it out (testIgnore/testMatch,
   * grep/grepInvert such as @local-only, --project, file arguments). It is on
   * disk but outside that run's `total`, so it is neither a result nor "not
   * run". The dashboards read this instead of re-deriving it.
   */
  excluded: boolean;
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
  /**
   * Counted in `total` but produced no verdict in THIS run: the run planned it
   * but never got to it (global timeout, a failed dependency project,
   * --max-failures, a spec that failed to load) or it was interrupted.
   * null = legacy count: written before this field existed and its report was
   * not available to recompute from, so the counts may include results carried
   * over from older runs. Absent only in summaries the next build hasn't
   * visited yet.
   */
  notRun?: number | null;
  /**
   * Why the run stopped before every planned test got a turn: Playwright's own
   * run-level message (the global timeout, in whatever task it fired, or
   * --max-failures), or its first run-level error when the run planned no test
   * at all. null = it ran to the end, except on a legacy count (notRun: null),
   * where null means unknown: there was no report to tell.
   */
  cutShort?: string | null;
  /**
   * Whether runs/<id>/ (Playwright report, videos, traces, run.log) still
   * exists after this build's prune: true for the newest RUN_LIMIT runs, false
   * for older ones, whose counts and per-test results stay but whose report is
   * gone, so the dashboards must not link into it. Once false it stays false.
   * Absent in summaries written before this field existed: treat as true.
   */
  hasReport?: boolean;
  /**
   * The RUN_LIMIT this run was built with. While a run built with a larger
   * one still has its report, later builds keep that many reports (see
   * buildCatalog). Absent in summaries written before this field existed.
   */
  runLimit?: number;
  /** On disk but not planned by this run (see CatalogTest.excluded); outside `total`. */
  excluded: number;
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
  /** Run-level errors, e.g. "Timed out waiting 4800s for the test suite to run". */
  errors?: Array<{ message?: string }>;
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
  /** Runs kept in history/catalog (default DEFAULT_HISTORY_LIMIT). */
  historyLimit?: number;
  /**
   * Runs that keep runs/<id>/ on disk (default DEFAULT_REPORT_LIMIT). Only runs
   * in the history window can keep one, so above historyLimit it has no effect.
   * With local runs, a larger limit a recent run was built with wins (see
   * buildCatalog).
   */
  reportLimit?: number;
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

/** One test the report planned, with its last result (undefined = it never started). */
interface ReportEntry {
  spec: PwSpec;
  result: PwResult | undefined;
  describePath: string[];
}

/**
 * Every test one report PLANNED, keyed by the AST id (file:line:title).
 *
 * This is what tells `notRun` from `excluded` (checked against Playwright
 * 1.59.1's JSON reporter): every test the run scheduled is listed, and one it
 * never got to (global timeout, a failed dependency project, --max-failures)
 * is listed with `results: []`. A test the config or command line filtered
 * out (testIgnore/testMatch, grep/grepInvert, --project, file arguments) is
 * not listed at all.
 */
function indexReport(report: PwReport): Map<string, ReportEntry> {
  // Playwright's JSON reporter emits spec.file relative to config.rootDir
  // (= testDir, e.g. `<repo>/tests`), so it lacks the `tests/` prefix that
  // the AST ids carry. Older versions emitted absolute paths. Resolve against
  // rootDir first so both shapes normalize to the same cwd-relative id the
  // AST produces — otherwise nothing matches and every lastStatus is null.
  const reportRootDir = report.config?.rootDir || process.cwd();
  const byId = new Map<string, ReportEntry>();
  for (const { spec, describePath } of flattenSpecs(report)) {
    const absFile = path.isAbsolute(spec.file) ? spec.file : path.resolve(reportRootDir, spec.file);
    const file = path.relative(process.cwd(), absFile).replace(/\\/g, '/');
    const id = `${file}:${spec.line}:${spec.title}`;
    const t = (spec.tests || [])[0];
    if (!t) continue;
    const results = t.results || [];
    byId.set(id, { spec, result: results[results.length - 1], describePath });
  }
  return byId;
}

type RunCounts = Record<'passed' | 'failed' | 'skipped' | 'timedOut' | 'notRun' | 'excluded' | 'total', number>;

/**
 * A result's verdict, or undefined when it produced none. 'interrupted' means
 * Playwright stopped the test mid-flight (Ctrl-C / SIGINT): it started but
 * reached no verdict. The global timeout does not produce it: Playwright
 * 1.59 reports the test in flight when that fires as 'skipped', the same as
 * a test skipped after a serial-mode or beforeAll failure, so that one test
 * counts as skipped; the ones after it have no result and count as not run.
 */
function verdictOf(result: PwResult | undefined): TestStatus | undefined {
  return result && result.status !== 'interrupted' ? result.status : undefined;
}

/**
 * Tally one run in a single pass. Each entry is one test in the suite with its
 * verdict (undefined = no result in that run); `excluded` entries are left out
 * of `total` entirely. See the did-not-run note in buildCatalog for why
 * `notRun` and `excluded` are kept apart.
 */
function tally(entries: Iterable<{ verdict: TestStatus | undefined; excluded: boolean }>): RunCounts {
  const c: RunCounts = { passed: 0, failed: 0, skipped: 0, timedOut: 0, notRun: 0, excluded: 0, total: 0 };
  for (const { verdict, excluded } of entries) {
    if (excluded) { c.excluded++; continue; }
    c.total++;
    if (verdict === undefined) c.notRun++;
    else if (verdict === 'passed') c.passed++;
    else if (verdict === 'skipped') c.skipped++;
    else if (verdict === 'failed' || verdict === 'timedOut') {
      c.failed++;
      if (verdict === 'timedOut') c.timedOut++;
    }
  }
  return c;
}

/**
 * Counts for a PAST run, from that run's own report.json alone. Its spec
 * entries (tests/**\/*.spec.ts, the same files the AST walk reads) are the
 * suite as that run planned it, so the result doesn't depend on how today's
 * specs have moved or grown. Entries with no result are that run's not-run
 * tests. A test the run didn't plan isn't in its report at all, so `excluded`
 * here is always 0: see recount for what a recomputed summary keeps instead.
 */
function countReport(report: PwReport): RunCounts {
  const entries: Array<{ verdict: TestStatus | undefined; excluded: boolean }> = [];
  for (const { spec } of flattenSpecs(report)) {
    if (!/\.spec\.ts$/.test(spec.file)) continue; // fixtures/*.setup.ts are not tests in the catalog
    const t = (spec.tests || [])[0];
    entries.push({ verdict: verdictOf(t?.results?.[t.results.length - 1]), excluded: false });
  }
  return tally(entries);
}

/**
 * A summary written before `notRun` existed, recounted from that run's own
 * report.json (see the recompute in buildCatalog). The outcome counts,
 * `notRun` and `total` come from the report. `excluded` keeps the stored
 * value: it was that build's call against the spec tree it saw, and a report
 * can't say which specs on disk it left out. A report that planned no test at
 * all (a spec failed to load, global setup threw) means nothing ran: the
 * stored total stays and all of it is not run, as buildCatalog counts such a
 * run today.
 */
function recount(stored: RunSummary, report: PwReport): RunSummary {
  const counts = countReport(report);
  if (counts.total === 0) {
    return {
      ...stored, passed: 0, failed: 0, skipped: 0, timedOut: 0, notRun: stored.total,
      cutShort: cutShortOf(report) ?? firstRunError(report) ?? 'Playwright planned no tests',
    };
  }
  return { ...stored, ...counts, excluded: stored.excluded ?? 0, cutShort: cutShortOf(report) };
}

/**
 * Playwright's run-level message when the run stopped before every test got a
 * turn — the global timeout or --max-failures — else null. Matched on those
 * two messages only, so an unrelated run-level error (a fixture, a teardown)
 * isn't read as cut short. The global timeout names whichever task was running
 * when it fired (taskRunner.js: `for the ${currentTaskName} to run`): "test
 * suite", "global setup", "start dev server", "teardown for test suite"…
 */
const CUT_SHORT = [
  /^Timed out waiting [\d.]+s for the .+ to run/,
  /^Testing stopped early after \d+ maximum allowed failures/,
];
function cutShortOf(report: PwReport): string | null {
  return runErrors(report).find(m => CUT_SHORT.some(re => re.test(m))) ?? null;
}

/** First line of each run-level error, colour codes stripped. */
function runErrors(report: PwReport): string[] {
  return (report.errors || [])
    .map(e => (e.message || '').replace(/\x1b\[[0-9;]*m/g, '').split('\n')[0].trim());
}

/**
 * Why a run that planned no test at all stopped, e.g. "Error: Cannot find
 * module …" from a spec that failed to load: its first run-level error.
 */
function firstRunError(report: PwReport): string | null {
  return runErrors(report).find(Boolean) ?? null;
}

function buildCatalog(opts: BuildOptions): { catalog: Catalog; nextHistory: HistoryFile } {
  if (!fs.existsSync(opts.reportPath)) {
    throw new Error(`report.json not found at ${opts.reportPath}`);
  }
  const report = JSON.parse(fs.readFileSync(opts.reportPath, 'utf8')) as PwReport;
  const ast = collectFromAst();
  const astById = new Map(ast.map(r => [r.id, r]));

  const seenIds = new Set<string>();
  const reportById = indexReport(report);
  // A run that planned none of the tests on disk never got as far as
  // scheduling: a spec that fails to load aborts the whole run with an empty
  // report, and so does a global setup that throws. Such a report can't say
  // what the config would have left out, so each test keeps the previous
  // build's call (on a first build, the @local-only rule playwright.config.ts
  // applies unless LOCAL_STACK=1) and everything else counts as not run —
  // never as excluded, which would turn a broken run into an empty one.
  const plannedNothing = !ast.some(r => reportById.has(r.id));
  const localStack = process.env.LOCAL_STACK === '1';

  const oldHistory = readHistory(opts.publicHistoryPath ?? opts.historyPath);
  const priorCatalog = readPriorCatalog(opts.publicCatalogPath ?? null);
  const historyLimit = opts.historyLimit ?? DEFAULT_HISTORY_LIMIT;
  const requestedLimit = opts.reportLimit ?? DEFAULT_REPORT_LIMIT;

  // Every prior run summary stays for the whole history window, whether or not
  // its runs/<id>/ folder survived: its counts and the per-test results that
  // point at it are still worth showing. What a pruned run loses is the
  // drill-down, so each summary records `hasReport` and the dashboards only
  // link into runs that have one.
  const priorRuns = oldHistory.runs.filter(r => r.id !== opts.runId).slice(0, historyLimit - 1);
  /** Every run the new catalog lists (the history window), with or without a report. */
  const listedRunIds = new Set<string>([opts.runId, ...priorRuns.map(r => r.id)]);

  // The runs/ folders on disk are the source of truth for which reports the
  // dashboard can actually open. In the local-serve model (run-cycle.sh) the
  // published history/catalog live in the webroot next to runs/, so a run
  // whose folder an earlier cycle pruned, or that vanished by hand, has no
  // report — otherwise the catalog would point at a 404 (#907 skew). Only
  // trust disk when the runs are actually local (the current run's own folder
  // is present); the CI rsync model (publish.sh) publishes runs elsewhere and
  // prunes the host to the newest RUN_LIMIT, so there the window is logical.
  const runsDir = opts.publicHistoryPath
    ? path.join(path.dirname(opts.publicHistoryPath), 'runs')
    : null;
  const runsAreLocal = !!runsDir && fs.existsSync(path.join(runsDir, opts.runId));
  const runExists = (id: string): boolean =>
    !runsAreLocal || fs.existsSync(path.join(runsDir!, id));

  // One box can run the suite with two RUN_LIMITs: naipepea's nightly wrapper
  // passes 12, its RUN button 5 (integration_tests_runner_run_limit). Each run
  // used to prune runs/ to its own limit, so a button run cut the nightly's 12
  // reports down to 5 and the count never got back to 12. So, while any run
  // that still has its report was built with a larger RUN_LIMIT, keep that
  // many. Once those runs have lost their reports to newer ones, the smaller
  // limit applies again: lowering RUN_LIMIT everywhere takes effect within the
  // old limit's number of runs. Local runs only: publish.sh prunes the host to
  // exactly its own RUN_LIMIT, so there the flags must follow that.
  const reportLimit = runsAreLocal
    ? Math.max(requestedLimit, ...priorRuns
      .filter(r => r.hasReport !== false && runExists(r.id))
      .map(r => r.runLimit ?? 0))
    : requestedLimit;
  if (reportLimit > requestedLimit) {
    console.log(`[build-catalog] RUN_LIMIT=${requestedLimit}, but a run that still has its report was built with RUN_LIMIT=${reportLimit}: keeping ${reportLimit} reports`);
  }

  // Runs that keep their report after this cycle: newest first, the current
  // run plus each prior run whose folder still exists, up to reportLimit. A run
  // once marked pruned stays pruned (its report can't come back, even if the
  // limit is raised later). run-cycle.sh prunes runs/ to exactly this set, so a
  // link into one of them is guaranteed reachable; links into anything else
  // (latestRun pointers below, report links in the dashboards) are dropped.
  const reportRunIds = new Set<string>([opts.runId]);
  for (const r of priorRuns) {
    if (reportRunIds.size >= reportLimit) break;
    if (r.hasReport !== false && runExists(r.id)) reportRunIds.add(r.id);
  }

  // Merge: every test from disk → CatalogTest. Tests that ran get latestRun.
  // Tests that didn't run inherit their last-seen latestRun from the prior
  // catalog if and only if that run still has its report (videos, traces).
  const tests: CatalogTest[] = [];
  let preservedCount = 0;
  for (const rec of ast) {
    seenIds.add(rec.id);
    const entry = reportById.get(rec.id);
    const prior = priorCatalog.get(rec.id);
    const excluded = plannedNothing
      ? (typeof prior?.excluded === 'boolean' ? prior.excluded : !localStack && rec.tags.includes('@local-only'))
      : !entry;
    // An interrupted result reached no verdict, so it is handled exactly like
    // no result: the previous lastStatus/latestRun carry over and no history
    // entry is written — otherwise it would overwrite the last real result.
    const result = entry?.result && verdictOf(entry.result) ? entry.result : undefined;
    // Older builders also wrote a history entry for an interrupted result; it
    // reached no verdict either, so it is dropped like the result itself.
    const priorHistory = (oldHistory.perTest[rec.id] || []).filter(h => h.status !== 'interrupted');
    let lastStatus: TestStatus | null = null;
    let lastDurationMs: number | null = null;
    let latestRun: LatestRun | null = null;

    if (result) {
      // Playwright nests two status fields:
      //   test.status   : 'expected' | 'unexpected' | 'flaky' | 'skipped'
      //   result.status : 'passed'   | 'failed'     | 'timedOut' | 'skipped' | 'interrupted'
      // We want the result-level outcome — that's what users mean by "passed".
      lastStatus = result.status;
      lastDurationMs = result.duration;

      const screenshots: string[] = [];
      let videoUrl: string | null = null;
      let traceUrl: string | null = null;
      for (const a of result.attachments || []) {
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
        errorMessage: result.error?.message ?? null,
        errorStack: result.error?.stack ?? null,
      };
    } else if (prior?.latestRun && reportRunIds.has(prior.latestRun.runId)) {
      // Test didn't run this time. Keep the prior latestRun pointer if its
      // referenced run still has its report — its video/trace are still on
      // disk under runs/<id>/.
      if (prior.lastStatus !== 'interrupted') {
        latestRun = prior.latestRun;
        lastStatus = prior.lastStatus;
        lastDurationMs = prior.lastDurationMs;
        preservedCount++;
      } else {
        // A catalog from an older builder can hold an interrupted result as
        // the last outcome. It reached no verdict, so don't carry it: fall
        // back to the newest real result in the history (status only — the
        // media kept was the interrupted run's), or to no status at all. A
        // status needs no report, so any run the catalog still lists will do.
        const real = priorHistory[0];
        if (real && listedRunIds.has(real.runId)) {
          lastStatus = real.status;
          lastDurationMs = real.durationMs;
        }
      }
    }

    // History merge: prepend this run's outcome (if any) to prior history.
    const newHistory: HistoryEntry[] = result
      ? [{ runId: opts.runId, status: result.status, durationMs: result.duration }, ...priorHistory]
      : priorHistory;
    const trimmedHistory = newHistory.slice(0, historyLimit);

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
      ranInLatestRun: !!result,
      excluded,
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
  //
  // The outcome counts describe THIS run only. A test that produced no verdict
  // here lands in `notRun`, never in passed/failed via its carried-over
  // lastStatus: counting stale results is how bomet showed ~71% from 10-02 to
  // 10-05 while the suite was cut off at the 80-min global timeout and 68 tests
  // never started — the drop only appeared on 10-06, when the last run that
  // had reached them aged out of the window.
  //
  // A test on disk with no verdict is one of two very different things, and
  // only one is a signal:
  //
  //   a) the run PLANNED it but never got to it: the global timeout or
  //      --max-failures stopped the run, a dependency project failed, it was
  //      interrupted, or a spec failed to load and nothing ran at all. A real
  //      loss of coverage, and the reason the suite is enumerated from disk
  //      rather than from report.json's stats: it stays in `total` as `notRun`.
  //   b) the run never planned it: playwright.config.ts or the command line
  //      leaves it out by design. `grepInvert: /@local-only/` unless
  //      LOCAL_STACK=1 (those specs need the Keycloak admin port, 18180, which
  //      is loopback-only), develop's `testIgnore` for tests/identity-real/
  //      (they have their own config), a --grep or --project run. The AST walk
  //      still enumerates them, but they can never pass here: counted in
  //      `total` they are pure denominator. They are `excluded`, outside it.
  //
  // The report draws that line itself (indexReport): (a) is listed there with
  // no result, (b) is not listed at all. Deciding it from the report rather
  // than from a tag keeps every way of leaving a test out in (b): matching on
  // @local-only alone left develop's 3 identity-real specs in `notRun` on
  // every run. The flip side is that a spec dropped from the plan by mistake
  // (a bad testIgnore) is excluded too, so the dashboards show `excluded`.
  const newRun: RunSummary = {
    id: opts.runId,
    startedAt: report.stats?.startTime || new Date().toISOString(),
    durationMs: report.stats?.duration ?? 0,
    ...tally(tests.map(t => ({
      verdict: t.ranInLatestRun ? (t.lastStatus ?? undefined) : undefined,
      excluded: t.excluded,
    }))),
    cutShort: cutShortOf(report)
      ?? (plannedNothing && tests.some(t => !t.excluded) ? firstRunError(report) ?? 'Playwright planned no tests' : null),
    hasReport: true,
    runLimit: requestedLimit,
    sha: opts.sha,
    branch: opts.branch,
    baseUrl: opts.baseUrl,
  };

  // Summaries written before `notRun` existed counted carried-over results as
  // that run's outcome. Recompute each one still in the window from its OWN
  // runs/<id>/report.json (recount — never joined against today's specs,
  // which may have moved or grown since), so the trend doesn't show a fake
  // cliff between the last old-style run and the first honest one. When that
  // report isn't available (its runs/<id>/ folder is gone, the folder has no
  // readable report.json, or the runs are published elsewhere: the CI rsync
  // model, no runs/ next to the history), mark the summary `notRun: null` =
  // legacy count; the dashboards render it as such and don't compare against
  // it. A run whose folder is gone stays in the window either way, with
  // hasReport false. The result is persisted, so each old summary is visited
  // exactly once.
  let recomputed = 0;
  let markedLegacy = 0;
  const windowRuns = priorRuns.map((r): RunSummary => {
    const hasReport = reportRunIds.has(r.id);
    if (r.notRun !== undefined) return { ...r, hasReport };
    const p = runsAreLocal ? path.join(runsDir!, r.id, 'report.json') : null;
    if (p && fs.existsSync(p)) {
      try {
        const old = JSON.parse(fs.readFileSync(p, 'utf8')) as PwReport;
        recomputed++;
        return { ...recount(r, old), hasReport };
      } catch (e) {
        console.warn(`[build-catalog] could not recompute ${r.id} from ${p}: ${(e as Error).message}`);
      }
    }
    markedLegacy++;
    return { ...r, notRun: null, cutShort: null, hasReport };
  });
  if (recomputed) console.log(`[build-catalog] recomputed ${recomputed} pre-notRun run summaries from their own report.json`);
  if (markedLegacy) console.log(`[build-catalog] marked ${markedLegacy} pre-notRun run summaries as legacy counts (no report.json to recompute from)`);

  const catalog: Catalog = {
    generatedAt: new Date().toISOString(),
    lastRunId: opts.runId,
    tagFacets,
    tests: tests.sort((a, b) => a.id.localeCompare(b.id)),
    runs: [newRun, ...windowRuns],
  };

  // Persist next history.json.
  const nextPerTest: Record<string, HistoryEntry[]> = {};
  for (const t of tests) {
    if (t.history.length) nextPerTest[t.id] = t.history;
  }
  const nextHistory: HistoryFile = { perTest: nextPerTest, runs: catalog.runs };
  return { catalog, nextHistory };
}

/**
 * JSON for catalog.json / history.json: indented like before, except that each
 * per-test history entry sits on one line. With 30 runs of history the entries
 * outnumber everything else in the file, and an entry spread over five indented
 * lines is mostly whitespace. Field names stay as they are, so every reader of
 * the old format (both dashboards, scripts/regression-alert.mjs, jq) is unaffected.
 */
function stringifyCatalog(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(
    /\{\n\s*"runId": ("(?:[^"\\\n]|\\.)*"),\n\s*"status": ("\w+"),\n\s*"durationMs": ([-+.\deE]+)\n\s*\}/g,
    '{ "runId": $1, "status": $2, "durationMs": $3 }',
  );
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
  const historyLimit = limitFromEnv('HISTORY_LIMIT', DEFAULT_HISTORY_LIMIT);
  const reportLimit = limitFromEnv('RUN_LIMIT', DEFAULT_REPORT_LIMIT);

  const { catalog, nextHistory } = buildCatalog({
    runId, reportPath, historyPath, catalogPath,
    publicHistoryPath, publicCatalogPath, baseUrl, branch, sha,
    historyLimit, reportLimit,
  });
  fs.writeFileSync(catalogPath, stringifyCatalog(catalog));
  fs.writeFileSync(historyPath, stringifyCatalog(nextHistory));
  const withReport = catalog.runs.filter(r => r.hasReport !== false).length;
  console.log(`[build-catalog] wrote ${catalogPath} (${catalog.tests.length} tests, ${catalog.runs.length} runs, ${withReport} with a report)`);
  console.log(`[build-catalog] wrote ${historyPath}`);
}

if (require.main === module) main();

export {
  buildCatalog, collectFromAst, extractTags,
  // run accounting, exported for scripts/build-catalog.test.ts
  indexReport, verdictOf, tally, countReport, recount, cutShortOf,
  // retention, exported for scripts/build-catalog-retention.test.ts
  stringifyCatalog, limitFromEnv, DEFAULT_HISTORY_LIMIT, DEFAULT_REPORT_LIMIT,
};
export type { Catalog, CatalogTest, HistoryFile, RunSummary, PwReport };
