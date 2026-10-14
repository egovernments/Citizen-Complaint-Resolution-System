import { useSyncExternalStore } from 'react';
import { useGetList } from 'react-admin';
import { Button, Stack, Typography } from '@mui/material';
import { RUN_PAGE_STORAGE_KEY, clampPage, pageFor, windowOf, type StoredRunPage } from './runWindow';
import type { RunSummary } from './types';

/** catalog.runs in catalog order (newest first) — the order runSlots is aligned to. */
export function useCatalogRuns(): RunSummary[] {
  const { data } = useGetList<RunSummary>('runs', {
    pagination: { page: 1, perPage: 1000 },
    sort: { field: 'position', order: 'ASC' },
  });
  return data ?? [];
}

// The shared run page lives in sessionStorage: it survives a refresh and
// moving between the tests list, a test and the home dashboard, but a new tab
// or a later visit starts on the newest runs. Every view reads it through
// useSyncExternalStore, so moving the page in one redraws all of them.
const listeners = new Set<() => void>();
let inMemory: string | null = null; // when sessionStorage is unavailable

function readStoredPage(): string | null {
  try {
    return sessionStorage.getItem(RUN_PAGE_STORAGE_KEY);
  } catch {
    return inMemory;
  }
}

function writeStoredPage(value: StoredRunPage): void {
  inMemory = JSON.stringify(value);
  try {
    sessionStorage.setItem(RUN_PAGE_STORAGE_KEY, inMemory);
  } catch {
    // storage disabled: the page lasts until the tab reloads
  }
  listeners.forEach(notify => notify());
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/**
 * The run page every view shares (0 = newest five runs). It is stored with the
 * newest run it was picked against and drops back to the newest runs once a
 * newer run is in the catalog (runWindow.pageFor).
 */
export function useRunWindow() {
  const runs = useCatalogRuns();
  const raw = useSyncExternalStore(subscribe, readStoredPage, () => null);
  const lastRunId = runs[0]?.id;
  const win = windowOf(runs, pageFor(raw, lastRunId, runs.length));
  const setPage = (p: number) => {
    if (lastRunId) writeStoredPage({ page: clampPage(p, runs.length), lastRunId });
  };
  return { runs, win, setPage };
}

/** "‹ Newer  runs 6–10 of 30  Older ›" — moves the shared run window. */
export function RunPager() {
  const { win: w, setPage } = useRunWindow();
  return (
    <Stack direction="row" alignItems="center" spacing={0.5} data-testid="run-pager">
      <Button size="small" disabled={!w.hasNewer} onClick={() => setPage(w.page - 1)} title="Show the five newer runs">
        ‹ Newer
      </Button>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
        data-testid="run-window-label"
      >
        {w.label}
      </Typography>
      <Button size="small" disabled={!w.hasOlder} onClick={() => setPage(w.page + 1)} title="Show the five older runs">
        Older ›
      </Button>
    </Stack>
  );
}
