/**
 * #2803: level names boundary-service takes (200) but egov-persister can't store
 * (boundary_relationship.boundarytype varchar(64)), and repeated levels, are refused
 * before digit-mcp writes anything.
 *
 * Usage: npx tsx --test test-level-names.ts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { levelNameProblems, levelNamesError, normalizeLevelName } from './src/utils/level-names.js';
import { ToolRegistry } from './src/tools/registry.js';
import { registerAllTools } from './src/tools/index.js';
import { loadFromXlsx } from './src/utils/xlsx-loader.js';

describe('level-name rules', () => {
  it('match configurator: trim, single spaces, 64 characters, duplicates ignoring case and spaces', () => {
    assert.equal(normalizeLevelName('  Sub  \t county '), 'Sub county');
    assert.deepEqual(levelNameProblems(['County', 'x'.repeat(64), 'तालुका']), [null, null, null]);
    assert.deepEqual(levelNameProblems(['County', 'x'.repeat(65)]), [null, { kind: 'too_long', length: 65, max: 64 }]);
    assert.deepEqual(levelNameProblems(['Ward', 'ward', 'Sub county', 'Subcounty']), [null, { kind: 'duplicate', of: 0 }, null, { kind: 'duplicate', of: 2 }]);
    assert.deepEqual(levelNameProblems(['Wa\u0000rd', '']), [{ kind: 'control_char' }, { kind: 'required' }]);
    assert.equal(levelNamesError(['County', 'Ward']), null);
  });
});

describe('boundary_create', () => {
  const registry = new ToolRegistry({ readOnly: false });
  registerAllTools(registry);
  const tool = registry.getTool('boundary_create')!;

  it('refuses a hierarchy_definition level over 64 characters before calling DIGIT', async () => {
    await assert.rejects(
      tool.handler({ tenant_id: 'ke.nairobi', hierarchy_definition: ['County', 'w'.repeat(65)], boundaries: [{ code: 'NBI', type: 'County' }] }),
      /hierarchy_definition: Level 2 .*65 characters long\. Use 64 characters or fewer\./,
    );
  });

  it('refuses two levels with one name, ignoring case', async () => {
    await assert.rejects(
      tool.handler({ tenant_id: 'ke.nairobi', hierarchy_definition: ['County', 'Ward', 'WARD'], boundaries: [{ code: 'NBI', type: 'County' }] }),
      /hierarchy_definition: Level 3 \("WARD"\): Level 2 \("Ward"\) already has this name/,
    );
  });

  it('refuses a boundary type over 64 characters, even with no hierarchy_definition', async () => {
    await assert.rejects(
      tool.handler({ tenant_id: 'ke.nairobi', boundaries: [{ code: 'NBI_W1', type: 'w'.repeat(65), parent: 'NBI' }] }),
      /boundary "NBI_W1" type: This name is 65 characters long/,
    );
  });
});

describe('city_setup_from_xlsx boundary phase', () => {
  it('fails the phase on a boundaryType over 64 characters, before any hierarchy or area is written', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'level-names-'));
    try {
      const file = path.join(dir, 'boundaries.xlsx');
      const wb = new ExcelJS.Workbook();
      const sheet = wb.addWorksheet('Boundary');
      sheet.addRow(['code', 'name', 'boundaryType', 'parentCode']);
      sheet.addRow(['C1', 'Alpha County', 'County', '']);
      sheet.addRow(['W1', 'Ward One', 'W'.repeat(70), 'C1']);
      await wb.xlsx.writeFile(file);
      const result = await loadFromXlsx({ tenant_id: 'ke.nairobi', boundary_file: file });
      const phase = result.phases.boundaries;
      assert.equal(phase?.status, 'failed');
      assert.match(String(phase?.error), /^The boundaryType column can't be used as hierarchy levels\. Level 2 .*70 characters long\. Use 64 characters or fewer\. Fix the sheet and upload it again\.$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
