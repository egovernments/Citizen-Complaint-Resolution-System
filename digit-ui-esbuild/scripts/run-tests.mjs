// npm test: runs every *.test.{js,mjs,cjs,jsx} under the test roots with
// `node --test` (extra arguments are passed through). Fails if no file
// matches, instead of letting `node --test` discover the whole tree.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOTS = ['tests', 'src/theme', 'scripts/lib', 'products/dashboard'];
const files = ROOTS.flatMap((root) =>
  readdirSync(root, { recursive: true })
    .filter((f) => /\.test\.(js|mjs|cjs|jsx)$/.test(f) && !f.split(/[\\/]/).includes('node_modules'))
    .map((f) => join(root, f)),
).sort();
if (files.length === 0) {
  console.error('run-tests: no test files found under ' + ROOTS.join(', '));
  process.exit(1);
}
const { status } = spawnSync(process.execPath, ['--test', ...process.argv.slice(2), ...files], { stdio: 'inherit' });
process.exit(status ?? 1);
