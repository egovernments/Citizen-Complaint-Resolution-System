/**
 * #2803: level names boundary-service takes (200) but egov-persister can't store
 * (boundary_relationship.boundarytype varchar(64)), and repeated levels, are refused
 * before digit-mcp writes anything.
 *
 * Usage: npx tsx --test test-level-names.ts
 */
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import * as mcpRules from './src/utils/level-names.js';
// The configurator's copy of the rules: the two must agree (digit-mcp builds on its own).
import * as configuratorRules from '../configurator/packages/data-provider/src/levelNames.js';
import { levelNameIn, levelNameProblems, levelNamesError, normalizeLevelName, tooLongForLevel } from './src/utils/level-names.js';
import { ToolRegistry } from './src/tools/registry.js';
import { registerAllTools } from './src/tools/index.js';
import { loadFromXlsx } from './src/utils/xlsx-loader.js';
import { digitApi } from './src/services/digit-api.js';

describe('level-name rules', () => {
  it('match configurator: trim, single spaces, 64 characters, duplicates ignoring case and spaces', () => {
    assert.equal(normalizeLevelName('  Sub  \t county '), 'Sub county');
    assert.deepEqual(levelNameProblems(['County', 'x'.repeat(64), 'तालुका']), [null, null, null]);
    assert.deepEqual(levelNameProblems(['County', 'x'.repeat(65)]), [null, { kind: 'too_long', length: 65, max: 64 }]);
    assert.deepEqual(levelNameProblems(['Ward', 'ward', 'Sub county', 'Subcounty']), [null, { kind: 'duplicate', of: 0 }, null, { kind: 'duplicate', of: 2 }]);
    assert.deepEqual(levelNameProblems(['Wa\u0000rd', '']), [{ kind: 'control_char' }, { kind: 'required' }]);
    assert.equal(levelNamesError(['County', 'Ward']), null);
  });

  it('refuse invisible format characters, but take the joiners some scripts spell with', () => {
    assert.deepEqual(levelNameProblems(['Ward​', 'Wa­rd', '‎Zone']), [{ kind: 'control_char' }, { kind: 'control_char' }, { kind: 'control_char' }]);
    assert.deepEqual(levelNameProblems(['දිස්ත්‍රික්කය', 'Ward', 'Ward‍']), [null, null, { kind: 'duplicate', of: 1 }]);
  });

  it('measure the exact string sent, and spell an area\'s level as the hierarchy does', () => {
    assert.deepEqual(tooLongForLevel(` ${'x'.repeat(64)}`), { kind: 'too_long', length: 65, max: 64 });
    assert.equal(levelNameIn(['County', 'Sub  County'], 'Sub County'), 'Sub  County');
    assert.equal(levelNameIn(['County'], ' Ward  One '), 'Ward One');
  });
});

// The configurator's rules live in data-provider's levelNames.ts; digit-mcp keeps a copy. A change
// made in one only would let the configurator and MCP accept different names.
describe('the two copies of the rules', () => {
  const names: string[][] = [
    ['County', 'Sub  County', ' Ward '],
    ['Country', '', 'District', 'district'],
    ['Ward', 'ward', 'Sub county', 'Subcounty', 'Ward‍'],
    ['Wa\u0000rd', 'Ward​', 'Wa­rd', 'Ward⁠', 'Wa‮rd', 'දිස්ත්‍රික්කය'],
    ['Município', 'Município', 'x'.repeat(64), 'y'.repeat(65), '𝒜'.repeat(65), `  ${'z'.repeat(64)}  `],
  ];

  it('export the same functions', () => {
    assert.deepEqual(Object.keys(mcpRules).sort(), Object.keys(configuratorRules).sort());
    assert.equal(mcpRules.MAX_LEVEL_NAME_LENGTH, configuratorRules.MAX_LEVEL_NAME_LENGTH);
  });

  it('give the same answers', () => {
    for (const list of names) {
      for (const name of list) {
        assert.equal(mcpRules.normalizeLevelName(name), configuratorRules.normalizeLevelName(name), JSON.stringify(name));
        assert.equal(mcpRules.levelNameKey(name), configuratorRules.levelNameKey(name), JSON.stringify(name));
        assert.equal(mcpRules.shortLevelName(name), configuratorRules.shortLevelName(name), JSON.stringify(name));
        assert.deepEqual(mcpRules.tooLongForLevel(name), configuratorRules.tooLongForLevel(name), JSON.stringify(name));
        assert.equal(mcpRules.levelNameIn(list, name.trim()), configuratorRules.levelNameIn(list, name.trim()), JSON.stringify(name));
      }
      assert.deepEqual(mcpRules.levelNameProblems(list), configuratorRules.levelNameProblems(list), JSON.stringify(list));
      for (const check of [{}, { skipBlank: true }, { saved: true }]) {
        assert.deepEqual(mcpRules.firstLevelNameProblem(list, check), configuratorRules.firstLevelNameProblem(list, check), JSON.stringify([list, check]));
        assert.equal(mcpRules.levelNamesError(list, check), configuratorRules.levelNamesError(list, check), JSON.stringify([list, check]));
      }
      for (const problem of mcpRules.levelNameProblems(list)) {
        if (problem) assert.equal(mcpRules.levelNameProblemText(problem, list), configuratorRules.levelNameProblemText(problem, list));
      }
    }
  });
});

/** DIGIT as boundary_create and the xlsx loader see it: hierarchies saved, and what was sent. */
function fakeDigit(hierarchies: { hierarchyType: string; boundaryHierarchy: { boundaryType: string; parentBoundaryType?: string | null }[] }[]) {
  const sent = {
    hierarchies: [] as { tenantId: string; hierarchyType: string; levels: string[] }[],
    entities: [] as string[],
    relationships: [] as { code: string; boundaryType: string }[],
  };
  mock.method(digitApi, 'isAuthenticated', () => true);
  mock.method(digitApi, 'boundaryHierarchySearch', async (_tenantId: string, hierarchyType?: string) =>
    hierarchies.filter((h) => !hierarchyType || h.hierarchyType === hierarchyType),
  );
  mock.method(digitApi, 'boundaryHierarchyCreate', async (tenantId: string, hierarchyType: string, levels: { boundaryType: string }[]) => {
    if (hierarchies.some((h) => h.hierarchyType === hierarchyType)) throw new Error('DUPLICATE_RECORD');
    sent.hierarchies.push({ tenantId, hierarchyType, levels: levels.map((l) => l.boundaryType) });
    return {};
  });
  mock.method(digitApi, 'boundaryCreate', async (_tenantId: string, items: { code: string }[]) => {
    sent.entities.push(...items.map((i) => i.code));
    return items.map((i) => ({ code: i.code }));
  });
  mock.method(digitApi, 'boundarySearch', async (_tenantId: string, _type?: string, options?: { codes?: string[] }) =>
    (options?.codes ?? []).filter((c) => sent.entities.includes(c)).map((code) => ({ code })),
  );
  mock.method(digitApi, 'boundaryRelationshipCreate', async (_tenantId: string, code: string, _type: string, boundaryType: string) => {
    sent.relationships.push({ code, boundaryType });
    return {};
  });
  mock.method(digitApi, 'localizationUpsert', async () => ({}));
  return sent;
}

describe('boundary_create', () => {
  const registry = new ToolRegistry({ readOnly: false });
  registerAllTools(registry);
  const tool = registry.getTool('boundary_create')!;
  afterEach(() => mock.restoreAll());

  it('refuses a hierarchy_definition level over 64 characters before calling DIGIT', async () => {
    await assert.rejects(
      tool.handler({ tenant_id: 'ke.nairobi', hierarchy_definition: ['County', 'w'.repeat(65)], boundaries: [{ code: 'NBI', type: 'County' }] }),
      /hierarchy_definition: Level 2 .*65 characters long\. Use 64 characters or fewer\./,
    );
  });

  it('refuses two levels with one name, ignoring case, for a hierarchy it would create', async () => {
    const sent = fakeDigit([]);
    await assert.rejects(
      tool.handler({ tenant_id: 'ke.nairobi', hierarchy_definition: ['County', 'Ward', 'WARD'], boundaries: [{ code: 'NBI', type: 'County' }] }),
      /hierarchy_definition: Level 3 \("WARD"\): Level 2 \("Ward"\) already has this name/,
    );
    assert.deepEqual(sent, { hierarchies: [], entities: [], relationships: [] });
  });

  it('takes levels named alike when they name a hierarchy already saved, which keeps its own names', async () => {
    const sent = fakeDigit([{ hierarchyType: 'ADMIN', boundaryHierarchy: [{ boundaryType: 'Zone' }, { boundaryType: 'zone', parentBoundaryType: 'Zone' }] }]);
    const result = JSON.parse(String(await tool.handler({
      tenant_id: 'ke',
      hierarchy_definition: ['Zone', 'zone'],
      boundaries: [{ code: 'Z1', type: 'Zone' }, { code: 'Z1_A', type: 'zone', parent: 'Z1' }],
    })));
    assert.equal(result.success, true);
    assert.deepEqual(sent.hierarchies, []);
    assert.deepEqual(sent.relationships, [{ code: 'Z1', boundaryType: 'Zone' }, { code: 'Z1_A', boundaryType: 'zone' }]);
  });

  it('refuses a hierarchy_type over 64 characters before calling DIGIT', async () => {
    await assert.rejects(
      tool.handler({ tenant_id: 'ke', hierarchy_type: 'H'.repeat(65), hierarchy_definition: ['County', 'Ward'], boundaries: [{ code: 'NBI', type: 'County' }] }),
      /hierarchy_type: The hierarchy type is 65 characters long\. Use 64 characters or fewer\./,
    );
  });

  it('refuses a boundary type over 64 characters, even with no hierarchy_definition', async () => {
    await assert.rejects(
      tool.handler({ tenant_id: 'ke.nairobi', boundaries: [{ code: 'NBI_W1', type: 'w'.repeat(65), parent: 'NBI' }] }),
      /boundary "NBI_W1" type: This name is 65 characters long/,
    );
  });

  it('sends the level names tidied, and each area under its level', async () => {
    const sent = fakeDigit([]);
    await tool.handler({
      tenant_id: 'ke',
      hierarchy_definition: [' County ', 'Sub  County'],
      boundaries: [{ code: 'C1', type: 'County ' }, { code: 'S1', type: 'Sub   County', parent: 'C1' }],
    });
    assert.deepEqual(sent.hierarchies, [{ tenantId: 'ke', hierarchyType: 'ADMIN', levels: ['County', 'Sub County'] }]);
    assert.deepEqual(sent.relationships, [{ code: 'C1', boundaryType: 'County' }, { code: 'S1', boundaryType: 'Sub County' }]);
  });

  it('spells areas as a hierarchy saved before names were tidied does, and writes none under a saved name too long to store', async () => {
    let sent = fakeDigit([{ hierarchyType: 'ADMIN', boundaryHierarchy: [{ boundaryType: 'County' }, { boundaryType: 'Sub  County', parentBoundaryType: 'County' }] }]);
    await tool.handler({ tenant_id: 'ke', boundaries: [{ code: 'C1', type: 'County' }, { code: 'S1', type: 'Sub County', parent: 'C1' }] });
    assert.deepEqual(sent.relationships, [{ code: 'C1', boundaryType: 'County' }, { code: 'S1', boundaryType: 'Sub  County' }]);

    mock.restoreAll();
    // Tidied, the saved name is 64 characters, so the boundary's own type passes; as sent, it is 66.
    const saved = `Sub   ${'x'.repeat(60)}`;
    sent = fakeDigit([{ hierarchyType: 'ADMIN', boundaryHierarchy: [{ boundaryType: 'County' }, { boundaryType: saved, parentBoundaryType: 'County' }] }]);
    await assert.rejects(
      tool.handler({ tenant_id: 'ke', boundaries: [{ code: 'C1', type: 'County' }, { code: 'S1', type: `Sub ${'x'.repeat(60)}`, parent: 'C1' }] }),
      /The "ADMIN" hierarchy has a level name \("Sub x{36}…"\) 66 characters long; the database can store at most 64, so no boundaries were written\./,
    );
    assert.deepEqual(sent, { hierarchies: [], entities: [], relationships: [] });
  });
});

describe('city_setup_from_xlsx boundary phase', () => {
  let dir = '';
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'level-names-'));
  });
  afterEach(() => {
    mock.restoreAll();
    rmSync(dir, { recursive: true, force: true });
  });
  const sheet = async (rows: string[][]) => {
    const file = path.join(dir, 'boundaries.xlsx');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Boundary');
    ws.addRow(['code', 'name', 'boundaryType', 'parentCode']);
    for (const row of rows) ws.addRow(row);
    await wb.xlsx.writeFile(file);
    return file;
  };

  it('fails the phase on a boundaryType over 64 characters, before any hierarchy or area is written', async () => {
    const file = await sheet([['C1', 'Alpha County', 'County', ''], ['W1', 'Ward One', 'W'.repeat(70), 'C1']]);
    const result = await loadFromXlsx({ tenant_id: 'ke.nairobi', boundary_file: file });
    const phase = result.phases.boundaries;
    assert.equal(phase?.status, 'failed');
    assert.match(String(phase?.error), /^The boundaryType column can't be used as hierarchy levels\. Level 2 .*70 characters long\. Use 64 characters or fewer\. Fix the sheet and upload it again\.$/);
  });

  it('refuses levels named alike for a hierarchy it would create', async () => {
    const sent = fakeDigit([]);
    const file = await sheet([['Z1', 'North', 'Zone', ''], ['Z1_A', 'North A', 'zone', 'Z1']]);
    const phase = (await loadFromXlsx({ tenant_id: 'ke.nairobi', boundary_file: file })).phases.boundaries;
    assert.equal(phase?.status, 'failed');
    assert.match(String(phase?.error), /Level 2 \("zone"\): Level 1 \("Zone"\) already has this name\..* Fix the sheet and upload it again\.$/);
    assert.deepEqual(sent, { hierarchies: [], entities: [], relationships: [] });
  });

  it('loads into a hierarchy already saved with levels named alike, or spaced as before names were tidied, as it spells them', async () => {
    const sent = fakeDigit([
      { hierarchyType: 'OLD', boundaryHierarchy: [{ boundaryType: 'Zone' }, { boundaryType: 'zone', parentBoundaryType: 'Zone' }] },
      { hierarchyType: 'SPACED', boundaryHierarchy: [{ boundaryType: 'County' }, { boundaryType: 'Sub  County', parentBoundaryType: 'County' }] },
    ]);
    let phase = (await loadFromXlsx({ tenant_id: 'ke.nairobi', boundary_file: await sheet([['Z1', 'North', 'Zone', ''], ['Z1_A', 'North A', 'zone', 'Z1']]) })).phases.boundaries;
    assert.equal(phase?.status, 'completed', String(phase?.error));
    phase = (await loadFromXlsx({ tenant_id: 'ke.nairobi', boundary_file: await sheet([['C1', 'Alpha', 'County', ''], ['S1', 'Beta', 'Sub   County', 'C1']]) })).phases.boundaries;
    assert.equal(phase?.status, 'completed', String(phase?.error));
    assert.deepEqual(sent.hierarchies, []);
    assert.deepEqual(sent.relationships, [
      { code: 'Z1', boundaryType: 'Zone' },
      { code: 'Z1_A', boundaryType: 'zone' },
      { code: 'C1', boundaryType: 'County' },
      { code: 'S1', boundaryType: 'Sub  County' },
    ]);
  });

  it('creates a hierarchy with the sheet\'s levels tidied, and refuses a generated type too long to store', async () => {
    let sent = fakeDigit([]);
    const file = await sheet([['C1', 'Alpha', ' County', ''], ['S1', 'Beta', 'Sub   County', 'C1']]);
    await loadFromXlsx({ tenant_id: 'ke.nairobi', boundary_file: file });
    assert.deepEqual(sent.hierarchies, [{ tenantId: 'ke.nairobi', hierarchyType: 'NAIROBI_ADMIN', levels: ['County', 'Sub County'] }]);

    mock.restoreAll();
    sent = fakeDigit([]);
    const city = 'c'.repeat(60);
    const phase = (await loadFromXlsx({ tenant_id: `ke.${city}`, boundary_file: file })).phases.boundaries;
    assert.equal(phase?.status, 'failed');
    assert.equal(phase?.error, `The hierarchy type "${'C'.repeat(40)}…" is 66 characters long; the database can store at most 64. Nothing was written.`);
    assert.deepEqual(sent, { hierarchies: [], entities: [], relationships: [] });
  });
});
