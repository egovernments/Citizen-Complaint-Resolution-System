// npm test / test:watch: runs every src/**/*.test.ts except the *integration*
// files, which need a live DIGIT API (npm run test:integration). Extra
// arguments (e.g. --watch) are passed to `node --test`. Fails if no file
// matches, instead of letting `node --test` discover the whole tree.
import { readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const files = readdirSync('src', { recursive: true })
  .filter((f) => f.endsWith('.test.ts') && !basename(f).includes('integration'))
  .map((f) => join('src', f))
  .sort();
if (files.length === 0) {
  console.error('run-tests: no unit test files found under src/');
  process.exit(1);
}
const args = ['--import', 'tsx', '--test', ...process.argv.slice(2), ...files];
const { status } = spawnSync(process.execPath, args, { stdio: 'inherit' });
process.exit(status ?? 1);
