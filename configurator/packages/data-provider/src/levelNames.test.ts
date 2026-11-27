import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { DigitApiClient } from './client/DigitApiClient.js';
import { createDigitDataProvider } from './providers/dataProvider.js';
import {
  MAX_LEVEL_NAME_LENGTH,
  firstLevelNameProblem,
  levelNameIn,
  levelNameKey,
  levelNameProblems,
  levelNamesError,
  normalizeLevelName,
  tooLongForLevel,
} from './levelNames.js';

// #2803: a level name over 64 characters fails in egov-persister after boundary-service said 200,
// and the retries hold up every tenant; two levels with one name corrupt the hierarchy silently.
describe('level names', () => {
  it('normalizes: trims, folds whitespace runs to one space, composes accents', () => {
    assert.equal(normalizeLevelName('  Sub  \t county \n'), 'Sub county');
    assert.equal(normalizeLevelName('Munici\u0301pio'), 'Munic\u00edpio');
  });

  it('keys ignore case and spaces', () => {
    assert.equal(levelNameKey('Sub  County'), levelNameKey('subcounty'));
    assert.notEqual(levelNameKey('Sub-county'), levelNameKey('Subcounty'));
  });

  it('accepts ordinary and non-Latin names, and exactly 64 characters', () => {
    const sixtyFour = 'x'.repeat(MAX_LEVEL_NAME_LENGTH);
    assert.deepEqual(levelNameProblems(['County', 'Sub-county', 'तालुका', 'Município', sixtyFour]), [null, null, null, null, null]);
  });

  it('refuses a name over 64 characters, counting characters as Postgres does', () => {
    assert.deepEqual(levelNameProblems(['County', 'x'.repeat(65)]), [null, { kind: 'too_long', length: 65, max: 64 }]);
    // 64 astral characters are 128 UTF-16 units but 64 characters: allowed.
    assert.deepEqual(levelNameProblems(['𝒜'.repeat(64)]), [null]);
    // Surrounding spaces don't count against the limit; they are trimmed before saving.
    assert.deepEqual(levelNameProblems([`  ${'x'.repeat(64)}  `]), [null]);
  });

  it('refuses duplicates ignoring case and spacing, on the later level', () => {
    assert.deepEqual(levelNameProblems(['County', 'Ward', 'Ward']), [null, null, { kind: 'duplicate', of: 1 }]);
    assert.deepEqual(levelNameProblems(['County', 'ward', 'WARD']), [null, null, { kind: 'duplicate', of: 1 }]);
    assert.deepEqual(levelNameProblems(['Sub county', 'Sub  County']), [null, { kind: 'duplicate', of: 0 }]);
    assert.deepEqual(levelNameProblems(['Sub county', 'Subcounty']), [null, { kind: 'duplicate', of: 0 }]);
  });

  it('refuses blanks and hidden control characters', () => {
    assert.deepEqual(levelNameProblems(['  ', 'Wa\u0000rd', 'Wa\u0007rd']), [{ kind: 'required' }, { kind: 'control_char' }, { kind: 'control_char' }]);
  });

  it('refuses invisible format characters: zero-width space, direction marks, word joiner, soft hyphen', () => {
    for (const name of ['Ward\u200B', '\u200EWard', 'Wa\u00ADrd', 'Ward\u2060', 'Wa\u202Erd']) {
      assert.deepEqual(levelNameProblems(['County', name]), [null, { kind: 'control_char' }], JSON.stringify(name));
    }
  });

  it('takes the joiners some scripts spell with, and counts a joiner-only difference as the same name', () => {
    // Sinhala "district" is spelled with a zero-width joiner.
    assert.deepEqual(levelNameProblems(['County', 'දිස්ත්\u200Dරික්කය']), [null, null]);
    assert.deepEqual(levelNameProblems(['Ward', 'Ward\u200D']), [null, { kind: 'duplicate', of: 0 }]);
  });

  it('measures the exact string sent, not the tidied one', () => {
    assert.equal(tooLongForLevel('x'.repeat(64)), null);
    assert.deepEqual(tooLongForLevel(` ${'x'.repeat(64)}`), { kind: 'too_long', length: 65, max: 64 });
    assert.equal(tooLongForLevel('𝒜'.repeat(64)), null);
  });

  it('counts blank rows in "Level N" when they are skipped, and only what can\'t be stored for a saved hierarchy', () => {
    assert.deepEqual(firstLevelNameProblem(['Country', '', 'District', 'district'], { skipBlank: true }), {
      index: 3,
      problem: { kind: 'duplicate', of: 2 },
      name: 'district',
    });
    assert.equal(firstLevelNameProblem(['Country', '', 'District'], { skipBlank: true }), null);
    assert.equal(firstLevelNameProblem(['Zone', 'zone', ''], { saved: true }), null);
    assert.deepEqual(firstLevelNameProblem(['Zone', 'zone', 'y'.repeat(70)], { saved: true })?.index, 2);
  });

  it('spells an area\'s level as the hierarchy does, tidying a name that is none of its levels', () => {
    // A hierarchy saved before names were tidied keeps its spelling: boundary-service matches it exactly.
    assert.equal(levelNameIn(['County', 'Sub  County'], 'Sub County'), 'Sub  County');
    assert.equal(levelNameIn(['County', 'Munici\u0301pio'], 'Munic\u00edpio'), 'Munici\u0301pio');
    assert.equal(levelNameIn(['County', 'Sub County'], ' Sub  County '), 'Sub County');
    assert.equal(levelNameIn(['County'], ' Ward  One '), 'Ward One');
    assert.equal(levelNameIn([], 'ward'), 'ward');
  });

  it('levelNamesError names the first bad level in plain words', () => {
    assert.equal(levelNamesError(['County', 'Ward']), null);
    assert.equal(
      levelNamesError(['County', 'Ward', 'ward']),
      'Level 3 ("ward"): Level 2 ("Ward") already has this name. Give each level a different name; capital letters and spaces don’t make names different.',
    );
    assert.match(levelNamesError(['County', 'y'.repeat(70)]) ?? '', /^Level 2 \("y{40}…"\): This name is 70 characters long\. Use 64 characters or fewer\.$/);
  });
});

describe('create(boundary-hierarchies) level-name check', () => {
  const provider = () => {
    const client = new DigitApiClient({ url: 'https://test.example.com', stateTenantId: 'pg' });
    client.setAuth('token', { userName: 'admin', name: 'Admin', tenantId: 'pg' });
    const sent: unknown[] = [];
    mock.method(client, 'boundaryHierarchyCreate', async (_t: string, hierarchyType: string, levels: unknown) => {
      sent.push(levels);
      return { tenantId: 'pg', hierarchyType, boundaryHierarchy: levels };
    });
    return { dp: createDigitDataProvider(client, 'pg'), sent };
  };
  const create = (dp: ReturnType<typeof provider>['dp'], hierarchyType: string, names: string[]) =>
    dp.create('boundary-hierarchies', {
      data: {
        hierarchyType,
        boundaryHierarchy: names.map((boundaryType, i) => ({ boundaryType, parentBoundaryType: i ? names[i - 1] : null })),
      },
    });

  it('refuses a duplicate level before anything is sent', async () => {
    const { dp, sent } = provider();
    await assert.rejects(create(dp, 'ADMIN', ['County', 'Ward', 'WARD']), /Level 3 .*already has this name/);
    assert.equal(sent.length, 0);
  });

  it('refuses a level name over 64 characters before anything is sent', async () => {
    const { dp, sent } = provider();
    await assert.rejects(create(dp, 'ADMIN', ['County', 'w'.repeat(65)]), /65 characters long\. Use 64 characters or fewer/);
    assert.equal(sent.length, 0);
  });

  it('names the level as the editor counts its rows, blank rows included', async () => {
    const { dp, sent } = provider();
    await assert.rejects(
      create(dp, 'ADMIN', ['Country', '', 'District', 'district']),
      (e: Error) => e.message.startsWith('Level 4 ("district"): Level 3 ("District") already has this name.'),
    );
    assert.equal(sent.length, 0);
  });

  it('refuses a hierarchy type over 64 characters', async () => {
    const { dp, sent } = provider();
    await assert.rejects(create(dp, 'H'.repeat(65), ['County', 'Ward']), /hierarchy type is 65 characters long/);
    assert.equal(sent.length, 0);
  });

  it('saves normalized names, parents included', async () => {
    const { dp, sent } = provider();
    await create(dp, 'ADMIN', [' County ', 'Sub  county']);
    assert.deepEqual(sent[0], [
      { boundaryType: 'County', parentBoundaryType: null },
      { boundaryType: 'Sub county', parentBoundaryType: 'County' },
    ]);
  });
});
