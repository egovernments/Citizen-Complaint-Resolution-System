/**
 * OpenSRE sweep loop — how often it pays for an investigation.
 *
 * Every investigation is a billed model call, so the loop's dedupe is a cost
 * control, not a nicety. This runs the real run-sweeps.sh under /bin/sh for a
 * simulated day of sweeps, with stubs on PATH:
 *   - curl    serves a Gatus status list per sweep (and fails everything else)
 *   - opensre records each investigation and exits with STUB_OPENSRE_RC
 *   - date    reads a fake clock, so no real time passes
 *   - sleep   advances that clock, and ends the loop after STUB_SWEEPS sweeps
 * jq and timeout are the real ones.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const REPO = path.resolve(__dirname, '..', '..', '..');
const LOOP = path.join(REPO, 'local-setup', 'opensre', 'run-sweeps.sh');

const INTERVAL_S = 15 * 60;
const DEDUPE_S = 6 * 3600;
const DAY = 24 * 3600 / INTERVAL_S; // sweeps in 24 h
const T0 = 1_800_000_000;

// GNU date (-d @epoch), jq and timeout, as in the image and on CI runners.
const tools = spawnSync('sh', ['-c', 'command -v jq && command -v timeout && date -d @0 +%s'], {
  encoding: 'utf8',
});
const realDate = spawnSync('sh', ['-c', 'command -v date'], { encoding: 'utf8' }).stdout.trim();

const gatus = (failing: string[]) =>
  JSON.stringify(
    ['a', 'b', 'c', 'd'].map((key) => ({
      key,
      group: 'core',
      name: key.toUpperCase(),
      results: failing.includes(key)
        ? [{ success: false }, { success: false }, { success: false, errors: ['down'] }]
        : [{ success: true }],
    })),
  );

/**
 * Run `sweeps` sweeps. `failingAt(n)` is the failing check keys at sweep n,
 * or null for a Gatus that cannot be reached. Returns the clock offset (s)
 * of each investigation and the loop's records.
 */
function run(sweeps: number, failingAt: (n: number) => string[] | null, opensreRc: number) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opensre-loop-'));
  const bin = path.join(dir, 'bin');
  for (const d of [bin, path.join(dir, 'statuses'), path.join(dir, 'logs'), path.join(dir, 'home')]) {
    fs.mkdirSync(d, { recursive: true });
  }
  for (let n = 0; n < sweeps; n++) {
    const failing = failingAt(n);
    if (failing) fs.writeFileSync(path.join(dir, 'statuses', `${n}.json`), gatus(failing));
  }
  fs.writeFileSync(path.join(dir, 'clock'), String(T0));
  fs.writeFileSync(path.join(dir, 'sweep'), '0');

  const stub = (name: string, body: string) =>
    fs.writeFileSync(path.join(bin, name), `#!/bin/sh\nS=${JSON.stringify(dir)}\n${body}\n`, { mode: 0o755 });
  stub('curl', [
    'for a in "$@"; do case "$a" in',
    '  */api/v1/endpoints/statuses) f="$S/statuses/$(cat "$S/sweep").json"; [ -f "$f" ] || exit 7; cat "$f"; exit 0 ;;',
    'esac; done',
    'exit 7',
  ].join('\n'));
  stub('opensre', 'echo $(( $(cat "$S/clock") - ' + T0 + ' )) >> "$S/calls"\necho \'{"response":"stub report"}\'\nexit ${STUB_OPENSRE_RC:-0}');
  stub('date', `case " $* " in *" -d "*) exec ${realDate} "$@" ;; esac\nexec ${realDate} -d "@$(cat "$S/clock")" "$@"`);
  stub('sleep', [
    'n=$(( $(cat "$S/sweep") + 1 )); echo "$n" > "$S/sweep"',
    'echo $(( $(cat "$S/clock") + $1 )) > "$S/clock"',
    '[ "$n" -lt "$STUB_SWEEPS" ] || kill -TERM "$PPID"',
  ].join('\n'));

  spawnSync('sh', [LOOP], {
    encoding: 'utf8',
    timeout: 120_000,
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      HOME: path.join(dir, 'home'),
      OPENSRE_LOG_DIR: path.join(dir, 'logs'),
      OPENSRE_SWEEP_INTERVAL_MINUTES: String(INTERVAL_S / 60),
      OPENSRE_DEDUPE_HOURS: String(DEDUPE_S / 3600),
      OPENSRE_GATUS_URL: 'http://gatus.test',
      OPENSRE_ENABLED: 'true',
      ANTHROPIC_API_KEY: 'stub',
      STUB_SWEEPS: String(sweeps),
      STUB_OPENSRE_RC: String(opensreRc),
    },
  });
  const read = (f: string) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');
  const calls = read(path.join(dir, 'calls')).split('\n').filter(Boolean).map(Number);
  const records = read(path.join(dir, 'logs', 'sweeps.jsonl'))
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  const sweepsSeen = Number(read(path.join(dir, 'sweep')));
  fs.rmSync(dir, { recursive: true, force: true });
  return { calls, records, sweepsSeen };
}

(tools.status === 0 ? describe : describe.skip)('OpenSRE sweep loop cost controls', () => {
  test('a completed investigation covers its checks for the dedupe window', () => {
    const { calls, sweepsSeen } = run(DAY, () => ['a'], 0);
    expect(sweepsSeen).toBe(DAY);
    expect(calls).toEqual([0, DEDUPE_S, 2 * DEDUPE_S, 3 * DEDUPE_S]);
  });

  /**
   * Review 4181060069: a failed or timed-out run (possibly billed) used to be
   * retried on every sweep, 96 a day. It now backs off 2, 4, 8, ... sweeps,
   * capped at the dedupe window.
   */
  test('a failing investigation backs off instead of running every sweep', () => {
    const { calls, records } = run(DAY, () => ['a'], 1);
    const b = 2 * INTERVAL_S;
    expect(calls).toEqual([0, b, 3 * b, 7 * b, 15 * b, 15 * b + DEDUPE_S, 15 * b + 2 * DEDUPE_S]);
    expect(records.filter((r) => r.kind === 'investigation').every((r) => r.exit_code === 1)).toBe(true);
    expect(records.some((r) => r.kind === 'warning' && /retried from/.test(r.message))).toBe(true);
  });

  /**
   * Review 4181060074: the dedupe key used to be the exact set of failing
   * checks, so a noisy incident (a,b then a,b,c then a,c ...) paid for a new
   * run on every change. Only a check no investigation covers starts one now.
   */
  test('a changing set of failing checks re-investigates only for an uncovered check', () => {
    const plan = [['a', 'b'], ['a', 'b', 'c'], ['a', 'c'], ['a'], ['a', 'b']];
    const { calls, records } = run(20, (n) => plan[Math.floor(n / 4)], 0);
    expect(calls).toEqual([0, 4 * INTERVAL_S]);
    const investigated = records.filter((r) => r.kind === 'investigation').map((r) => r.trigger);
    expect(investigated).toEqual(['a,b', 'a,b,c']);
    expect(records.filter((r) => r.kind === 'unchanged')).toHaveLength(18);
  });

  // Review 4181060063: an unreachable Gatus used to start a run with no checks.
  test('an unreachable Gatus never starts an investigation', () => {
    const { calls, records } = run(8, () => null, 0);
    expect(calls).toEqual([]);
    expect(records.filter((r) => r.kind === 'error')).toHaveLength(8);
  });

  test('all checks passing never starts an investigation', () => {
    const { calls, records } = run(8, () => [], 0);
    expect(calls).toEqual([]);
    expect(records.filter((r) => r.kind === 'all_clear')).toHaveLength(8);
  });
});
