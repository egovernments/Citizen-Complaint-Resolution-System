#!/usr/bin/env node

import { readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testsDir = join(__dirname, 'tests');

// Allow running a single test via CLI arg
const onlyTest = process.argv[2] || null;

async function main() {
  const files = (await readdir(testsDir))
    .filter(f => f.endsWith('.test.mjs'))
    .sort();

  const tests = [];
  for (const file of files) {
    const mod = await import(join(testsDir, file));
    if (onlyTest && mod.name !== onlyTest) continue;
    tests.push({ file, ...mod });
  }

  if (tests.length === 0) {
    console.log(onlyTest ? `No test found matching "${onlyTest}"` : 'No test files found');
    process.exit(1);
  }

  console.log(`\nRunning ${tests.length} E2E test(s)...\n`);

  const results = [];
  for (const test of tests) {
    const label = `${test.name} — ${test.description}`;
    process.stdout.write(`  ⏳ ${test.name}: running...`);
    const start = Date.now();

    try {
      const result = await test.run();
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);

      if (result.success) {
        process.stdout.write(`\r  ✅ ${test.name}: ${JSON.stringify(result.created ?? {})} (${elapsed}s)\n`);
      } else {
        process.stdout.write(`\r  ❌ ${test.name}: ${result.error} (${elapsed}s)\n`);
      }

      results.push({ name: test.name, ...result, elapsed });
    } catch (err) {
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      process.stdout.write(`\r  ❌ ${test.name}: CRASH — ${err.message} (${elapsed}s)\n`);
      results.push({ name: test.name, success: false, error: err.message, elapsed });
    }
  }

  // Summary
  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed, ${results.length} total`);

  if (failed > 0) {
    console.log('\nFailed tests:');
    for (const r of results.filter(r => !r.success)) {
      console.log(`  - ${r.name}: ${r.error}`);
    }
    console.log('\nCheck e2e/screenshots/ for failure screenshots');
  }

  console.log('');
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Runner error:', err);
  process.exit(1);
});
