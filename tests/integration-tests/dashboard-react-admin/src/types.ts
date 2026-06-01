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
  lastStatus: TestStatus | null;
  lastDurationMs: number | null;
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
