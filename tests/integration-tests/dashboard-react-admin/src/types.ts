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

export interface CatalogTest {
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
  /** False when the test produced no verdict in the latest run (absent in older catalogs). */
  ranInLatestRun?: boolean;
  history: HistoryEntry[];
  latestRun: LatestRun | null;
  parseError: string | null;
}

export interface RunSummary {
  id: string;
  startedAt: string;
  durationMs: number;
  passed: number;
  failed: number;
  skipped: number;
  timedOut: number;
  /** In `total` but no verdict in this run (absent in older catalogs). */
  notRun?: number;
  /** Playwright's message when the run stopped early (e.g. global timeout). */
  cutShort?: string | null;
  total: number;
  sha: string;
  branch: string;
  baseUrl: string;
}

export interface Catalog {
  generatedAt: string;
  lastRunId: string;
  tagFacets: Record<string, string[]>;
  tests: CatalogTest[];
  runs: RunSummary[];
}
