import { describe, it, expect } from 'vitest';
import { resolveSlaPreview, cellToHours, levelCellToHours, SLA_SOURCE } from './resolveSlaPreview';
import type { SlaPreviewComplaint, SlaPreviewConfig } from './resolveSlaPreview';
import { effectiveHours } from './types';
import type { CategorySlaRecord } from './types';

// Mirrors the backend resolution test vectors (EscalationScheduler
// .resolveSlaHours / cellToMillis / levelCellToMillis) so the client
// preview can never silently diverge from the scheduler's decision.

const TUPLE = { path: 'health', category: 'Sanitation', subcategoryL1: 'Garbage' };

const EMPTY_DEFAULTS = {
  new: null,
  triage: null,
  forwarded: null,
  investigation: null,
  awaiting: null,
  resolved: null,
};

function row(partial: Partial<CategorySlaRecord> = {}): CategorySlaRecord {
  return { ...TUPLE, slaHoursByState: {}, isActive: true, ...partial };
}

function complaint(over: Partial<SlaPreviewComplaint> = {}): SlaPreviewComplaint {
  return { workflowState: 'PENDINGFORASSIGNMENT', escalationLevel: 0, ...TUPLE, ...over };
}

const MAPPING = { PENDINGFORASSIGNMENT: 'new', PENDINGATLME: 'forwarded' };

function config(over: Partial<SlaPreviewConfig> = {}): SlaPreviewConfig {
  return { rows: [], stateDefaults: null, policy: null, stateMapping: MAPPING, ...over };
}

describe('resolveSlaPreview precedence', () => {
  it('row-level cell beats row-state cell on the same row', () => {
    const r = resolveSlaPreview(
      complaint(),
      config({ rows: [row({ slaHoursByLevel: [120], slaHoursByState: { new: 48 } })] }),
    );
    expect(r.source).toBe(SLA_SOURCE.categoryLevel);
    expect(r.hours).toBe(120);
    // annotation still shows the state cell the level cell outranked
    expect(r.sources.find((s) => s.source === SLA_SOURCE.categoryState)?.hours).toBe(48);
  });

  it('row-state cell wins when the row has no level entry', () => {
    const r = resolveSlaPreview(
      complaint(),
      config({ rows: [row({ slaHoursByState: { new: 48 } })], stateDefaults: { ...EMPTY_DEFAULTS, new: 10 } }),
    );
    expect(r.source).toBe(SLA_SOURCE.categoryState);
    expect(r.hours).toBe(48);
  });

  it('policy level default beats the state default', () => {
    const r = resolveSlaPreview(
      complaint(),
      config({
        policy: { defaultSlaHoursByLevel: [72] },
        stateDefaults: { ...EMPTY_DEFAULTS, new: 24 },
      }),
    );
    expect(r.source).toBe(SLA_SOURCE.policyLevel);
    expect(r.hours).toBe(72);
    expect(r.sources.find((s) => s.source === SLA_SOURCE.stateDefault)?.hours).toBe(24);
  });

  it('state default wins when no category/policy source has a value', () => {
    const r = resolveSlaPreview(
      complaint(),
      config({ stateDefaults: { ...EMPTY_DEFAULTS, new: 24 } }),
    );
    expect(r.source).toBe(SLA_SOURCE.stateDefault);
    expect(r.hours).toBe(24);
  });

  it('legacy fallback is the terminal answer, never a miss', () => {
    const r = resolveSlaPreview(complaint(), config());
    expect(r.source).toBe(SLA_SOURCE.legacy);
    expect(r.hours).toBeNull(); // value lives server-side
    expect(r.stateMappingMissing).toBe(false); // state WAS mapped, StateSLA just had no entry
  });
});

describe('level-entry fall-through (null / 0 / negative / out-of-bounds)', () => {
  it('null hole at the current level falls through to the state cell', () => {
    const r = resolveSlaPreview(
      complaint(),
      config({ rows: [row({ slaHoursByLevel: [null, 48], slaHoursByState: { new: 24 } })] }),
    );
    expect(r.source).toBe(SLA_SOURCE.categoryState);
    expect(r.hours).toBe(24);
  });

  it('the same array hits at a level whose entry is positive', () => {
    const r = resolveSlaPreview(
      complaint({ escalationLevel: 1 }),
      config({ rows: [row({ slaHoursByLevel: [null, 48], slaHoursByState: { new: 24 } })] }),
    );
    expect(r.source).toBe(SLA_SOURCE.categoryLevel);
    expect(r.hours).toBe(48);
  });

  it.each([[0], [-5]])('non-positive entry %d falls through', (bad) => {
    const r = resolveSlaPreview(
      complaint(),
      config({ rows: [row({ slaHoursByLevel: [bad], slaHoursByState: { new: 24 } })] }),
    );
    expect(r.source).toBe(SLA_SOURCE.categoryState);
    expect(r.hours).toBe(24);
  });

  it('out-of-bounds level index falls through', () => {
    const r = resolveSlaPreview(
      complaint({ escalationLevel: 3 }),
      config({ rows: [row({ slaHoursByLevel: [120], slaHoursByState: { new: 24 } })] }),
    );
    expect(r.source).toBe(SLA_SOURCE.categoryState);
    expect(r.hours).toBe(24);
  });

  it('a missing escalationLevel counts as level 0', () => {
    const r = resolveSlaPreview(
      complaint({ escalationLevel: undefined }),
      config({ rows: [row({ slaHoursByLevel: [120, 48] })] }),
    );
    expect(r.level).toBe(0);
    expect(r.hours).toBe(120);
  });
});

describe('range cells collapse via MAX', () => {
  it('collapses [24, 120] to 120', () => {
    const r = resolveSlaPreview(
      complaint(),
      config({ rows: [row({ slaHoursByState: { new: [24, 120] } })] }),
    );
    expect(r.hours).toBe(120);
    expect(r.rawValue).toEqual([24, 120]);
  });

  it('collapses the REVERSED pair [120, 24] to 120 (Math.max, not r[1])', () => {
    const r = resolveSlaPreview(
      complaint(),
      config({ rows: [row({ slaHoursByState: { new: [120, 24] } })] }),
    );
    expect(r.hours).toBe(120);
  });

  it('types.ts effectiveHours agrees on reversed pairs', () => {
    expect(effectiveHours([120, 24])).toBe(120);
    expect(effectiveHours([24, 120])).toBe(120);
  });
});

describe('first-matching-row break semantics', () => {
  it('locks onto the first matching row; a null cell there breaks, later rows are ignored', () => {
    const first = row({ slaHoursByState: { new: null } });
    const second = row({ slaHoursByState: { new: 99 } });
    const r = resolveSlaPreview(complaint(), config({ rows: [first, second] }));
    expect(r.source).toBe(SLA_SOURCE.legacy); // fell through PAST CategorySLA entirely
    expect(r.matchedRow).toBe(first);
  });

  it('inactive rows never match', () => {
    const r = resolveSlaPreview(
      complaint(),
      config({
        rows: [
          row({ isActive: false, slaHoursByState: { new: 99 } }),
          row({ slaHoursByState: { new: 48 } }),
        ],
      }),
    );
    expect(r.hours).toBe(48);
  });

  it('a matching row WITHOUT a slaHoursByState object is skipped, not locked (backend continue)', () => {
    const broken = { ...TUPLE, isActive: true } as unknown as CategorySlaRecord;
    const next = row({ slaHoursByState: { new: 99 } });
    const r = resolveSlaPreview(complaint(), config({ rows: [broken, next] }));
    expect(r.source).toBe(SLA_SOURCE.categoryState);
    expect(r.hours).toBe(99);
    expect(r.matchedRow).toBe(next);
  });
});

describe('no workflow-state mapping', () => {
  it('skips state sources but level sources still hit', () => {
    const r = resolveSlaPreview(
      complaint(),
      config({
        stateMapping: null,
        rows: [row({ slaHoursByLevel: [36], slaHoursByState: { new: 48 } })],
        stateDefaults: { ...EMPTY_DEFAULTS, new: 24 },
      }),
    );
    expect(r.source).toBe(SLA_SOURCE.categoryLevel);
    expect(r.hours).toBe(36);
    expect(r.stateKey).toBeNull();
  });

  it('falls to legacy with stateMappingMissing when no level source answers', () => {
    const r = resolveSlaPreview(
      complaint(),
      config({
        stateMapping: null,
        rows: [row({ slaHoursByState: { new: 48 } })],
        stateDefaults: { ...EMPTY_DEFAULTS, new: 24 },
      }),
    );
    expect(r.source).toBe(SLA_SOURCE.legacy);
    expect(r.stateMappingMissing).toBe(true);
    // both per-state annotation rows are flagged blocked
    expect(r.sources.find((s) => s.source === SLA_SOURCE.categoryState)?.blocked).toBe(true);
    expect(r.sources.find((s) => s.source === SLA_SOURCE.stateDefault)?.blocked).toBe(true);
  });

  it('an unmapped status behaves the same as no mapping for that complaint', () => {
    const r = resolveSlaPreview(
      complaint({ workflowState: 'SOMETHING_ELSE' }),
      config({ stateDefaults: { ...EMPTY_DEFAULTS, new: 24 } }),
    );
    expect(r.source).toBe(SLA_SOURCE.legacy);
    expect(r.stateMappingMissing).toBe(true);
  });
});

describe('category tuple handling', () => {
  it('flags unmappedCategory when additionalDetail has no tuple; level sources still apply', () => {
    const r = resolveSlaPreview(
      complaint({ path: undefined }),
      config({ policy: { defaultSlaHoursByLevel: [72] } }),
    );
    expect(r.unmappedCategory).toBe(true);
    expect(r.source).toBe(SLA_SOURCE.policyLevel);
    expect(r.hours).toBe(72);
    expect(r.sources.find((s) => s.source === SLA_SOURCE.categoryLevel)?.blocked).toBe(true);
  });
});

describe('StateSLA layer mirrors the backend exactly (no positivity check)', () => {
  it('an explicit 0 in the defaults row WINS with 0 hours', () => {
    const r = resolveSlaPreview(
      complaint(),
      config({ stateDefaults: { ...EMPTY_DEFAULTS, new: 0 } }),
    );
    expect(r.source).toBe(SLA_SOURCE.stateDefault);
    expect(r.hours).toBe(0);
  });
});

describe('cell helpers mirror cellToMillis / levelCellToMillis', () => {
  it.each([
    [48, 48],
    [0, null],
    [-1, null],
    [[24, 120], 120],
    [[120, 24], 120],
    [[0, -2], null],
    [[24], null], // not a 2-tuple
    [null, null],
    [undefined, null],
    ['48', null], // strings never coerce
  ])('cellToHours(%j) → %j', (cell, expected) => {
    expect(cellToHours(cell)).toBe(expected);
  });

  it.each([
    [[120, 48], 0, 120],
    [[120, 48], 1, 48],
    [[120, 48], 2, null], // out of bounds
    [[120, 48], -1, null],
    [[null, 48], 0, null],
    [[0], 0, null],
    [undefined, 0, null],
    [{ 0: 120 }, 0, null], // not an array
  ])('levelCellToHours(%j, %d) → %j', (byLevel, level, expected) => {
    expect(levelCellToHours(byLevel, level)).toBe(expected);
  });
});
