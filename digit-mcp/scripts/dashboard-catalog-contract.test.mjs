import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertDashboardCatalogContract,
  dashboardCatalogContractErrors,
} from './dashboard-catalog-contract.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const unwrap = (record) => record?.data || record;

test('the canonical dashboard catalog satisfies the executable table contract', () => {
  const records = JSON.parse(fs.readFileSync(
    path.join(REPO, 'ansible/nairobi-mdms/mdms/dss/KpiDefinition.json'),
    'utf8'
  )).map(unwrap);
  assert.doesNotThrow(() => assertDashboardCatalogContract(records));
});

test('dead aliases and columns that the query cannot produce are rejected', () => {
  const errors = dashboardCatalogContractErrors([{
    id: 'broken_table',
    viz: {
      kind: 'table',
      valueKey: 'total',
      tableProfile: 'customAdapterThatDoesNotExist',
      columns: [{ id: 'renamedTotal' }],
    },
    query: {
      dimensions: ['ward_code'],
      measures: [{ agg: 'count', name: 'total' }],
    },
  }]);
  assert.ok(errors.some((error) => error.includes('viz.tableProfile')));
  assert.ok(errors.some((error) => error.includes('renamedTotal')));
});

test('comparison keys must cover the table grain and filters need one operator', () => {
  const errors = dashboardCatalogContractErrors([{
    id: 'broken_comparison',
    viz: {
      kind: 'table',
      valueKey: 'total',
      comparison: {
        period: 'prior',
        mode: 'percentChange',
        joinBy: ['ward_code'],
        valueKey: 'total',
        outputKey: 'trend_pct',
      },
      rowFilter: { column: 'missing', gte: 3, lt: 9 },
      columns: [{ id: 'trend_pct' }],
    },
    query: {
      dimensions: ['ward_code', 'service_code'],
      measures: [{ agg: 'count', name: 'total' }],
    },
  }]);
  assert.ok(errors.some((error) => error.includes('service_code')));
  assert.ok(errors.some((error) => error.includes('rowFilter column missing')));
  assert.ok(errors.some((error) => error.includes('exactly one supported operator')));
});
