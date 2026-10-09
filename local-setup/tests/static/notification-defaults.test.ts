/**
 * The shipped notification defaults have three generated copies that must never drift from their
 * source, and Python tests that guard the deploy's seeding decisions. None of them ran in CI on
 * their own, so this static suite runs them:
 *  - notifications_convert.py --check: mdmsData-dev/NOTIFICATIONS/* is the conversion of the legacy
 *    RAINMAKER-PGR.Notification* defaults;
 *  - test_onboarding_notification_defaults.py: the defaults pgr-services gives a new workspace
 *    (onboarding/notification-defaults.json) are the deploy's own;
 *  - test_notification_seed_decisions.py: what seed-notifications.py / migrate-notifications.py
 *    write, and how they authenticate (password or DIGIT_ACCESS_TOKEN).
 */
import { execFileSync } from 'child_process';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const run = (args: string[]) => execFileSync('python3', args, { cwd: REPO_ROOT, encoding: 'utf8', stdio: 'pipe' });

describe('shipped notification defaults', () => {
  test('the NOTIFICATIONS.* defaults are the conversion of the legacy defaults', () => {
    expect(run(['local-setup/scripts/notifications_convert.py', '--check'])).toMatch(/^OK: /m);
  });

  test('the workspace defaults pgr-services packages match the deploy seed, and the seed decisions hold', () => {
    // unittest writes its report to stderr; a failure throws with the report attached.
    expect(() => run(['-m', 'unittest',
      'local-setup/tests/test_onboarding_notification_defaults.py',
      'local-setup/tests/test_notification_seed_decisions.py'])).not.toThrow();
  });
});
