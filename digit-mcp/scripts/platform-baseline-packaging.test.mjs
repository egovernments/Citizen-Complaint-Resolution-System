import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const seedName = 'platform-baseline-v1.json';
const canonical = new URL('../../backend/pgr-services/src/main/resources/onboarding/' + seedName, import.meta.url);

test('npm archive ships canonical bytes and resolves its loader outside the checkout', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'baseline-package-'));
  try {
    const [packed] = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temp], { cwd: root, encoding: 'utf8' }));
    assert.ok(packed.files.some(file => file.path === `dist/data/${seedName}`));
    execFileSync('tar', ['-xzf', join(temp, packed.filename), '-C', temp]);
    assert.deepEqual(readFileSync(join(temp, 'package/dist/data', seedName)), readFileSync(canonical));
    const { loadPlatformSeed } = await import(pathToFileURL(join(temp, 'package/dist/tools/platform-baseline.js')).href);
    assert.deepEqual(loadPlatformSeed(), JSON.parse(readFileSync(canonical, 'utf8')));
  } finally { rmSync(temp, { recursive: true, force: true }); }
});

test('standalone Docker staging requires supplied seed and copies its exact bytes', () => {
  const temp = mkdtempSync(join(tmpdir(), 'baseline-standalone-'));
  try {
    mkdirSync(join(temp, 'scripts'));
    copyFileSync(new URL('./stage-platform-baseline.mjs', import.meta.url), join(temp, 'scripts/stage-platform-baseline.mjs'));
    const missing = spawnSync(process.execPath, ['scripts/stage-platform-baseline.mjs'], { cwd: temp, encoding: 'utf8' });
    assert.notEqual(missing.status, 0, 'a standalone build must not silently create an empty seed');
    mkdirSync(join(temp, 'data'));
    copyFileSync(canonical, join(temp, 'data', seedName));
    execFileSync(process.execPath, ['scripts/stage-platform-baseline.mjs'], { cwd: temp });
    for (const dir of ['data', 'src/data', 'dist/data']) {
      assert.deepEqual(readFileSync(join(temp, dir, seedName)), readFileSync(canonical));
    }
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
