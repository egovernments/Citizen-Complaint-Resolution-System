/**
 * Static regression tests for PGR employee inbox pagination (issue #916).
 *
 * Root cause: two independent bugs prevented the Next-page button from ever
 * being enabled:
 *
 *  1. The frontend config (PGRSearchInboxConfig.js used by micro-ui) was
 *     missing `totalCountJsonPath: "totalCount"`.  Without it the
 *     ResultsDataTableWrapper receives TotalCount=undefined, so
 *     data?.[undefined] is always undefined, totalPages collapses to 1,
 *     and currentPage === totalPages is permanently true.
 *
 *  2. The libraries/usePGRInboxSearch hook returned totalCount: wrappers.length
 *     (current page size, typically 10) instead of querying the _count API.
 *     Even after fixing #1, indexOfLastRow (10) >= data.totalCount (10)
 *     disabled Next on page 1.
 *
 * PR #964 fixed only the esbuild/products config — the micro-ui frontend
 * config and the libraries hook were left broken.  These tests ensure both
 * files stay correct and guard against future regressions.
 */
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

const FRONTEND_CONFIG =
  'frontend/micro-ui/web/micro-ui-internals/packages/modules/pgr/src/configs/PGRSearchInboxConfig.js';

const LIBRARIES_HOOK =
  'digit-ui-esbuild/packages/libraries/src/hooks/pgr/usePGRInboxSearch.js';

const PRODUCTS_CONFIG =
  'digit-ui-esbuild/products/pgr/src/configs/PGRSearchInboxConfig.js';

describe('PGR inbox pagination — frontend config (micro-ui)', () => {
  let src: string;
  beforeAll(() => { src = read(FRONTEND_CONFIG); });

  // Bug #1: missing totalCountJsonPath caused TotalCount prop to be undefined
  // inside ResultsDataTableWrapper → totalPages always 1 → Next always disabled.
  test('searchResult section declares totalCountJsonPath: "totalCount"', () => {
    expect(src).toContain('totalCountJsonPath: "totalCount"');
  });

  // Sanity: resultsJsonPath must still be present alongside it.
  test('searchResult section still declares resultsJsonPath: "items"', () => {
    expect(src).toContain('resultsJsonPath: "items"');
  });

  // Ordering: totalCountJsonPath should appear near resultsJsonPath (within
  // 300 chars) so they stay in the same uiConfig block.
  test('totalCountJsonPath appears in the same uiConfig block as resultsJsonPath', () => {
    const resultsIdx = src.indexOf('resultsJsonPath: "items"');
    const totalIdx   = src.indexOf('totalCountJsonPath: "totalCount"');
    expect(resultsIdx).toBeGreaterThan(-1);
    expect(totalIdx).toBeGreaterThan(-1);
    expect(Math.abs(totalIdx - resultsIdx)).toBeLessThan(300);
  });
});

describe('PGR inbox pagination — libraries hook', () => {
  let src: string;
  beforeAll(() => { src = read(LIBRARIES_HOOK); });

  // Bug #2: hook returned totalCount: wrappers.length (current page size)
  // instead of fetching the real total from the _count endpoint.
  test('derives countUrl by replacing _search with _count', () => {
    expect(src).toContain('url.replace("_search", "_count")');
  });

  test('calls search and count in parallel with Promise.all', () => {
    expect(src).toContain('Promise.all');
  });

  test('uses countResponse?.count as the source of truth for totalCount', () => {
    expect(src).toContain('countResponse?.count');
  });

  // Guard: the broken fallback (wrappers.length used directly as totalCount)
  // must not appear as a standalone assignment anymore.
  test('does not hard-code totalCount: wrappers.length', () => {
    expect(src).not.toContain('totalCount: wrappers.length');
  });

  // The _count call should be wrapped in .catch(() => null) so a 404/500
  // on the count endpoint degrades gracefully instead of breaking the whole inbox.
  test('count API call has a .catch fallback for graceful degradation', () => {
    expect(src).toMatch(/countUrl.*\n.*\.catch\(\(\) => null\)|\.catch\(\(\) => null\)/s);
  });
});

describe('PGR inbox pagination — esbuild products config', () => {
  let src: string;
  beforeAll(() => { src = read(PRODUCTS_CONFIG); });

  // PR #964 already fixed this file; this test keeps it from regressing.
  test('searchResult section declares totalCountJsonPath: "totalCount"', () => {
    expect(src).toContain('totalCountJsonPath: "totalCount"');
  });
});
