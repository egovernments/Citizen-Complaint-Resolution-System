/**
 * RunButton — triggers an on-box Playwright run via the test-runner daemon and
 * reflects its progress. The daemon sits behind nginx at /integration-tests/api/
 * under the SAME basic-auth as the dashboard, so `credentials: 'include'` reuses
 * the creds the browser already has — no separate login.
 *
 * A run is long (~1h), so this is fire-and-poll: POST /run returns immediately,
 * then we poll /run/current until it goes idle and refresh the catalog.
 *
 * The API base is absolute (both dashboards live on the same vhost) and
 * overridable at build time with VITE_RUNNER_API_BASE.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, useNotify, useRefresh } from 'react-admin';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import HourglassTopIcon from '@mui/icons-material/HourglassTop';
import { refreshCatalog } from './dataProvider';

const API_BASE = (import.meta.env.VITE_RUNNER_API_BASE as string) || '/integration-tests/api';
const POLL_MS = 10_000;

type Current =
  | { state: 'idle'; run_id?: string; exit_code?: number | null }
  | { state: 'running'; run_id: string; started_at: string; phase: string | null };

export default function RunButton() {
  const notify = useNotify();
  const refresh = useRefresh();
  // The runner is opt-in (enable_integration_tests_runner) and its API may not
  // be deployed at all. Start hidden and only reveal the button once a probe
  // succeeds, so dashboards without the runner don't show a button that 404s.
  const [reachable, setReachable] = useState(false);
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const wasRunning = useRef(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/run/current`, { credentials: 'include' });
      if (!r.ok) return;
      setReachable(true);
      const cur = (await r.json()) as Current;
      const isRunning = cur.state === 'running';
      setRunning(isRunning);
      setPhase(cur.state === 'running' ? cur.phase : null);
      if (wasRunning.current && !isRunning) {
        // A run just finished — drop the cached catalog AND invalidate
        // react-admin's query cache so the list/show views refetch.
        notify('Test run finished — refreshing results', { type: 'info' });
        refreshCatalog()
          .catch(() => undefined)
          .finally(() => refresh());
      }
      wasRunning.current = isRunning;
    } catch {
      /* daemon unreachable — stays hidden / leaves the button as-is */
    }
  }, [notify, refresh]);

  useEffect(() => {
    poll();
    timer.current = setInterval(poll, POLL_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [poll]);

  const onClick = useCallback(async () => {
    setStarting(true);
    try {
      const r = await fetch(`${API_BASE}/run`, { method: 'POST', credentials: 'include' });
      if (r.status === 202) {
        const { run_id } = await r.json();
        notify(`Started test run ${run_id}`, { type: 'success' });
        setRunning(true);
        wasRunning.current = true;
      } else if (r.status === 409) {
        const { run_id } = await r.json();
        notify(`A run is already in progress (${run_id})`, { type: 'warning' });
        setRunning(true);
        wasRunning.current = true;
      } else {
        notify(`Could not start run (HTTP ${r.status})`, { type: 'error' });
      }
    } catch (e) {
      notify(`Could not reach the test runner: ${String(e)}`, { type: 'error' });
    } finally {
      setStarting(false);
    }
  }, [notify]);

  // Hidden until the runner API answers — no button on runner-less dashboards.
  if (!reachable) return null;

  const label = running ? (phase ? `Running… (${phase})` : 'Running…') : 'Run tests';

  return (
    <Button
      label={label}
      onClick={onClick}
      disabled={running || starting}
      startIcon={running ? <HourglassTopIcon /> : <PlayArrowIcon />}
    />
  );
}
