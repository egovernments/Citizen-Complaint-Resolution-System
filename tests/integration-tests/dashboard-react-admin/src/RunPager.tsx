import { useGetList, useStore } from 'react-admin';
import { Button, Stack, Typography } from '@mui/material';
import { RUN_PAGE_STORE_KEY, clampPage, windowOf } from './runWindow';
import type { RunSummary } from './types';

/** catalog.runs in catalog order (newest first) — the order runSlots is aligned to. */
export function useCatalogRuns(): RunSummary[] {
  const { data } = useGetList<RunSummary>('runs', {
    pagination: { page: 1, perPage: 1000 },
    sort: { field: 'position', order: 'ASC' },
  });
  return data ?? [];
}

/**
 * The run page every view shares (0 = newest five runs). Kept in the
 * react-admin store, which persists to localStorage, so it survives a refresh
 * and moving between the tests list, a test and the home dashboard.
 */
export function useRunWindow() {
  const runs = useCatalogRuns();
  const [stored, setStored] = useStore<number>(RUN_PAGE_STORE_KEY, 0);
  const win = windowOf(runs, stored);
  const setPage = (p: number) => setStored(clampPage(p, runs.length));
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
