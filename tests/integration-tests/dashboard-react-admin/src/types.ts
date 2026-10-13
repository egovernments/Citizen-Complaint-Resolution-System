/**
 * Wire types for the catalog.json the runner publishes.
 * Mirrors scripts/build-catalog.ts in the repo root — keep in sync.
 */

export type TestStatus =
  | 'passed'
  | 'failed'
  | 'skipped'
  | 'timedOut'
  | 'interrupted';

export interface HistoryEntry {
  runId: string;
  status: TestStatus;
  durationMs: number;
}

export interface LatestRun {
  runId: string;
  videoUrl: string | null;
  traceUrl: string | null;
  screenshotUrls: string[];
  errorMessage: string | null;
  errorStack: string | null;
}

/**
 * Latest-run status, bucketed the way the run summary counts it: the verdict
 * when it reached one; 'notrun' when the run planned it but produced none
 * (whether or not an earlier run reached it); 'excluded' when the run never
 * planned it, so it is outside the total.
 */
export type CurrentStatus = TestStatus | 'notrun' | 'excluded';

/** One slot per run in catalog.runs, newest first: that run's entry, or a not-run marker. */
export type RunSlot = HistoryEntry | { runId: string; notRun: true };

export interface CatalogTest {
  id: string;
  title: string;
  describe: string;
  file: string;
  line: number;
  tags: string[];
  description: string | null;
  source: string;
  /** Last KNOWN outcome — may come from an older run. Read currentStatus instead. */
  lastStatus: TestStatus | null;
  lastDurationMs: number | null;
  /**
   * False when the test produced no verdict in the latest run. Older catalogs
   * lack it; dataProvider derives it, so after load it is always set.
   */
  ranInLatestRun?: boolean;
  /**
   * The builder's call: the latest run never planned this test (Playwright
   * config or command line), so it is outside that run's total. Older
   * catalogs lack it; dataProvider derives it, so after load it is always set.
   */
  excluded?: boolean;
  history: HistoryEntry[];
  latestRun: LatestRun | null;
  parseError: string | null;
  // ---- derived by dataProvider on load (not in catalog.json) ----
  /** What every list/badge/filter/sort reads: correct by default, no flag to remember. */
  currentStatus?: CurrentStatus;
  /** currentStatus's place in normalize's STATUS_SEVERITY (0 = most urgent); the Status column sorts on it. */
  statusRank?: number;
  /**
   * History aligned to catalog.runs (all of them, newest first), so a dot means
   * the same run on every row. Views show one page of it (runWindow.ts).
   */
  runSlots?: RunSlot[];
}

export interface RunSummary {
  id: string;
  startedAt: string;
  durationMs: number;
  passed: number;
  failed: number;
  skipped: number;
  timedOut: number;
  /**
   * In `total` but no verdict in this run. null or absent = legacy count:
   * recorded before not-run tracking, may include carried-over results.
   */
  notRun?: number | null;
  /**
   * Playwright's message when the run stopped early (e.g. global timeout).
   * null = it ran to the end, except on a legacy count, where it is unknown.
   */
  cutShort?: string | null;
  /**
   * False once runs/<id>/ (Playwright report, videos, traces, run.log) was
   * pruned: only the newest RUN_LIMIT runs keep one. The run's counts and
   * per-test results stay; nothing may link into it. Absent (older catalogs) =
   * still there.
   */
  hasReport?: boolean;
  /** The RUN_LIMIT the run was built with (absent in older catalogs). */
  runLimit?: number;
  total: number;
  sha: string;
  branch: string;
  baseUrl: string;
  // ---- derived by dataProvider on load (not in catalog.json) ----
  /** Index in catalog.runs: 0 = newest. Sort on it to get the order runSlots uses. */
  position?: number;
}

export interface Catalog {
  generatedAt: string;
  lastRunId: string;
  tagFacets: Record<string, string[]>;
  tests: CatalogTest[];
  runs: RunSummary[];
}
