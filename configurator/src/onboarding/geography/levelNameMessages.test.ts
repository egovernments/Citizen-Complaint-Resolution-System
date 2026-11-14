import { describe, expect, it } from 'vitest';
import { fixLevelNames, hierarchyTypeMessage, levelNameMessages, levelNamesProblem } from './levelNameMessages';

const label = (i: number) => `Level ${i + 1}`;

// #2803: what a level-name field says under a name that can't be saved.
describe('level name messages', () => {
  it('says nothing under names that are fine, or blank (the screen asks for those itself)', () => {
    expect(levelNameMessages(['County', 'Sub-county', 'तालुका', ''], label)).toEqual([null, null, null, null]);
  });

  it('says how long a name is and the limit', () => {
    expect(levelNameMessages(['County', 'x'.repeat(65)], label)).toEqual([null, 'This name is 65 characters long. Use 64 characters or fewer.']);
  });

  it('names the level that already has the name, ignoring case and spacing', () => {
    expect(levelNameMessages(['County', 'Sub county', 'sub  County'], label)).toEqual([
      null,
      null,
      'Level 2 already has this name. Give each level a different name; capital letters and spaces don’t make names different.',
    ]);
  });

  it('asks for a hidden character to be retyped', () => {
    expect(levelNameMessages(['Wa\u0000rd'], label)[0]).toMatch(/hidden control character/);
  });

  it('refuses a hierarchy type name over 64 characters', () => {
    expect(hierarchyTypeMessage('ADMIN')).toBeNull();
    expect(hierarchyTypeMessage(` ${'H'.repeat(64)} `)).toBeNull();
    expect(hierarchyTypeMessage('H'.repeat(65))).toBe('The hierarchy type name is 65 characters long. Use 64 characters or fewer.');
  });

  it('puts the first unusable name in a sentence', () => {
    expect(levelNamesProblem(['County', 'Ward'])).toBeNull();
    expect(levelNamesProblem(['County', ''])).toBe('One of the levels has no name.');
    expect(levelNamesProblem(['County', 'Ward', 'ward'])).toMatch(/^Two levels are called "ward"\./);
    // A saved hierarchy's names can't change: only what can't be stored counts.
    expect(levelNamesProblem(['County', 'Ward', 'ward'], undefined, true)).toBeNull();
    expect(levelNamesProblem(['County', 'x'.repeat(65)], undefined, true)).toMatch(/is 65 characters long/);
    expect(fixLevelNames()).toBe('Some level names can’t be used. Fix the names marked above, then continue.');
  });
});
