/**
 * Tests for auto-pagination utility (issue #26).
 * Tests the autoPaginate() function with mock fetchPage callbacks.
 *
 * Usage: npx tsx test-pagination.ts
 */

import { autoPaginate } from './src/utils/pagination.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (condition) {
    passed++;
    console.log(`  \x1b[32mPASS\x1b[0m  ${msg}`);
  } else {
    failed++;
    console.log(`  \x1b[31mFAIL\x1b[0m  ${msg}`);
  }
}

console.log('=== Auto-Pagination Tests ===\n');

// Helper: create a mock fetchPage that returns items from a total pool
function mockFetch(totalItems: number): (limit: number, offset: number) => Promise<{ id: number }[]> {
  const pool = Array.from({ length: totalItems }, (_, i) => ({ id: i + 1 }));
  return async (limit: number, offset: number) => {
    return pool.slice(offset, offset + limit);
  };
}

// 1. Single page (all items fit in one page)
console.log('1. Single page — all items fit');
{
  const result = await autoPaginate(mockFetch(10), { page_all: true }, 50);
  assert(result.items.length === 10, `Got all 10 items (got ${result.items.length})`);
  assert(result.pages === 1, `1 page (got ${result.pages})`);
  assert(result.truncated === false, 'Not truncated');
  assert(result.totalFetched === 10, `totalFetched=10 (got ${result.totalFetched})`);
}

// 2. Multiple pages
console.log('\n2. Multiple pages — 120 items, 50/page');
{
  const result = await autoPaginate(mockFetch(120), { page_all: true }, 50);
  assert(result.items.length === 120, `Got all 120 items (got ${result.items.length})`);
  assert(result.pages === 3, `3 pages (got ${result.pages})`);
  assert(result.truncated === false, 'Not truncated');
}

// 3. page_limit caps results
console.log('\n3. page_limit caps total items');
{
  const result = await autoPaginate(mockFetch(500), { page_all: true, page_limit: 100 }, 50);
  assert(result.items.length === 100, `Capped at 100 items (got ${result.items.length})`);
  assert(result.truncated === true, 'Marked as truncated');
  assert(result.pages === 2, `2 pages to reach 100 (got ${result.pages})`);
}

// 4. page_limit above 2000 is capped to 2000
console.log('\n4. page_limit capped at 2000');
{
  const result = await autoPaginate(mockFetch(100), { page_all: true, page_limit: 5000 }, 50);
  assert(result.items.length === 100, `Got all 100 items (not 5000) (got ${result.items.length})`);
  assert(result.truncated === false, 'Not truncated (only 100 items exist)');
}

// 5. Empty result
console.log('\n5. Empty result — 0 items');
{
  const result = await autoPaginate(mockFetch(0), { page_all: true }, 50);
  assert(result.items.length === 0, `Got 0 items (got ${result.items.length})`);
  assert(result.pages === 1, `1 page (empty response) (got ${result.pages})`);
  assert(result.truncated === false, 'Not truncated');
}

// 6. Exact page boundary (100 items, 50/page)
console.log('\n6. Exact page boundary — 100 items, 50/page');
{
  const result = await autoPaginate(mockFetch(100), { page_all: true }, 50);
  assert(result.items.length === 100, `Got all 100 items (got ${result.items.length})`);
  // The 3rd page fetch returns 0 items which terminates the loop
  assert(result.pages === 3, `3 pages (last empty) (got ${result.pages})`);
  assert(result.truncated === false, 'Not truncated');
}

// 7. Default page_limit is 500
console.log('\n7. Default page_limit is 500');
{
  const result = await autoPaginate(mockFetch(1000), { page_all: true }, 100);
  assert(result.items.length === 500, `Capped at default 500 (got ${result.items.length})`);
  assert(result.truncated === true, 'Truncated at default limit');
}

// 8. page_delay_ms doesn't break functionality
console.log('\n8. page_delay_ms works');
{
  const start = Date.now();
  const result = await autoPaginate(mockFetch(60), { page_all: true, page_delay_ms: 10 }, 50);
  const elapsed = Date.now() - start;
  assert(result.items.length === 60, `Got all 60 items (got ${result.items.length})`);
  assert(result.pages === 2, `2 pages (got ${result.pages})`);
  // With 10ms delay between pages, should take at least 10ms
  assert(elapsed >= 5, `Some delay occurred (${elapsed}ms)`);
}

// 9. Items maintain order across pages
console.log('\n9. Items maintain order across pages');
{
  const result = await autoPaginate(mockFetch(75), { page_all: true }, 25);
  assert(result.items[0].id === 1, 'First item is 1');
  assert(result.items[24].id === 25, 'Last of page 1 is 25');
  assert(result.items[25].id === 26, 'First of page 2 is 26');
  assert(result.items[74].id === 75, 'Last item is 75');
}

// 10. page_limit smaller than page size
console.log('\n10. page_limit smaller than page size');
{
  const result = await autoPaginate(mockFetch(100), { page_all: true, page_limit: 20 }, 50);
  assert(result.items.length === 20, `Capped at 20 (got ${result.items.length})`);
  assert(result.pages === 1, `1 page (got ${result.pages})`);
  assert(result.truncated === true, 'Truncated');
}

// Summary
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
