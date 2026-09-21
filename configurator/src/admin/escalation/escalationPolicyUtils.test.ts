import { describe, it, expect } from 'vitest';
import {
  formatDurationMs,
  computeTriggerPreview,
  validateLadder,
  buildBreadcrumb,
  buildHierarchyCatalogue,
  normalizeOverride,
  diffEscalationPolicy,
} from './escalationPolicyUtils';
import type { EscalationConfigData } from './escalationPolicyTypes';

describe('escalationPolicyUtils', () => {
  describe('formatDurationMs', () => {
    it('formats 0 or invalid ms', () => {
      expect(formatDurationMs(0)).toBe('0s');
      expect(formatDurationMs(-100)).toBe('0s');
    });

    it('formats hours and days correctly', () => {
      expect(formatDurationMs(3_600_000)).toBe('1h');
      expect(formatDurationMs(14_400_000)).toBe('4h');
      expect(formatDurationMs(86_400_000)).toBe('1d');
      expect(formatDurationMs(90_000_000)).toBe('1d 1h');
    });
  });

  describe('computeTriggerPreview', () => {
    it('returns formatted trigger time for valid inputs', () => {
      expect(computeTriggerPreview(10, 60)).toBe('6h after complaint creation');
      expect(computeTriggerPreview(10, 80)).toBe('8h after complaint creation');
      expect(computeTriggerPreview(10, 125)).toBe('12.5h after complaint creation');
    });

    it('returns dash for missing or invalid inputs', () => {
      expect(computeTriggerPreview(0, 80)).toBe('—');
      expect(computeTriggerPreview(10, 0)).toBe('—');
    });
  });

  describe('validateLadder', () => {
    it('passes for valid strictly increasing percentages and fallbacks', () => {
      const res = validateLadder([80, 120, 200], [3600000, 14400000, 86400000]);
      expect(res.valid).toBe(true);
      expect(res.pctErrors.every((e) => e === null)).toBe(true);
      expect(res.fallbackErrors.every((e) => e === null)).toBe(true);
    });

    it('flags percentages exceeding 200%', () => {
      const res = validateLadder([80, 120, 250], [1000, 2000, 3000]);
      expect(res.valid).toBe(false);
      expect(res.pctErrors[2]).toBe('Cannot exceed 200%');
    });

    it('flags non-integer float percentages', () => {
      const res = validateLadder([80.5, 120, 180], [1000, 2000, 3000]);
      expect(res.valid).toBe(false);
      expect(res.pctErrors[0]).toBe('Must be a whole number (integer)');
    });

    it('flags non-integer float fallbacks', () => {
      const res = validateLadder([80, 120, 180], [1000.5, 2000, 3000]);
      expect(res.valid).toBe(false);
      expect(res.fallbackErrors[0]).toBe('Must be a whole number of milliseconds');
    });

    it('flags non-increasing percentages', () => {
      const res = validateLadder([80, 70, 150], [1000, 2000, 3000]);
      expect(res.valid).toBe(false);
      expect(res.pctErrors[1]).toContain('Must be greater than L1');
    });

    it('flags non-increasing or negative fallbacks', () => {
      const res = validateLadder([80, 120, 180], [3000, 2000, 5000]);
      expect(res.valid).toBe(false);
      expect(res.fallbackErrors[1]).toContain('Must be greater than L1');

      const negRes = validateLadder([80], [-1]);
      expect(negRes.valid).toBe(false);
      expect(negRes.fallbackErrors[0]).toBe('Cannot be negative');
    });
  });

  describe('buildBreadcrumb', () => {
    it('constructs ancestor chain using parentCode', () => {
      const nodeMap = new Map<string, Record<string, unknown>>([
        ['WATER', { code: 'WATER', name: 'Water' }],
        ['SUPPLY', { code: 'SUPPLY', name: 'Supply', parentCode: 'WATER' }],
        ['LEAK', { code: 'LEAK', name: 'Pipe Leak', parentCode: 'SUPPLY' }],
      ]);

      expect(buildBreadcrumb('LEAK', nodeMap)).toBe('Water › Supply › Pipe Leak');
    });

    it('handles root or missing parent gracefully', () => {
      const nodeMap = new Map<string, Record<string, unknown>>([
        ['LEAK', { code: 'LEAK', name: 'Pipe Leak' }],
      ]);
      expect(buildBreadcrumb('LEAK', nodeMap)).toBe('Pipe Leak');
    });
  });

  describe('buildHierarchyCatalogue', () => {
    it('classifies leaves and terminal nodes as fileable and attaches overrides', () => {
      const records = [
        {
          uniqueIdentifier: 'WATER',
          isActive: true,
          data: { code: 'WATER', name: 'Water' },
        },
        {
          uniqueIdentifier: 'SUPPLY',
          isActive: true,
          data: { code: 'SUPPLY', name: 'Supply', parentCode: 'WATER' },
        },
        {
          uniqueIdentifier: 'LEAK',
          isActive: true,
          data: {
            code: 'LEAK',
            name: 'Pipe Leak',
            parentCode: 'SUPPLY',
            department: 'WATER_DEPT',
            slaHours: 12,
          },
        },
        {
          uniqueIdentifier: 'POTHOLE',
          isActive: true,
          // Terminal node with no children, carries slaHours
          data: { code: 'POTHOLE', name: 'Pothole', slaHours: 24, department: 'ROADS' },
        },
      ];

      const overrides = {
        LEAK: {
          slaPercentageByLevel: [60, 100, 180],
          slaByLevel: [3600000, 14400000, 86400000],
          enabledByLevel: [true, true, false],
        },
        UNKNOWN_LEAF: {
          slaPercentageByLevel: [50, 100],
          enabledByLevel: [true, true],
        },
      };

      const { catalogue, orphanedOverrides } = buildHierarchyCatalogue(records, overrides);

      expect(catalogue.length).toBe(2);
      const leak = catalogue.find((c) => c.code === 'LEAK');
      expect(leak).toBeDefined();
      expect(leak?.override).toEqual(overrides.LEAK);
      expect(leak?.path).toBe('Water › Supply › Pipe Leak');

      const pothole = catalogue.find((c) => c.code === 'POTHOLE');
      expect(pothole).toBeDefined();
      expect(pothole?.override).toBeUndefined();

      expect(orphanedOverrides.length).toBe(1);
      expect(orphanedOverrides[0].code).toBe('UNKNOWN_LEAF');
      expect(orphanedOverrides[0].isOrphaned).toBe(true);
    });
  });

  describe('diffEscalationPolicy', () => {
    it('summarizes changes accurately', () => {
      const orig: EscalationConfigData = {
        code: 'DEFAULT',
        maxDepth: 3,
        eligibleStatuses: ['PENDINGATLME'],
        defaultSlaPercentageByLevel: [80, 120, 200],
        defaultSlaByLevel: [3600000, 14400000, 86400000],
        enabledByLevel: [true, true, true],
        overrides: {},
      };

      const draft: EscalationConfigData = {
        ...orig,
        maxDepth: 4,
        eligibleStatuses: ['PENDINGATLME', 'PENDINGFORASSIGNMENT'],
        defaultSlaPercentageByLevel: [60, 120, 200, 250],
        enabledByLevel: [true, true, false, true],
        overrides: {
          LEAK: {
            slaPercentageByLevel: [50, 100, 150],
            enabledByLevel: [true, true, true],
          },
        },
      };

      const diffs = diffEscalationPolicy(orig, draft);
      expect(diffs.some((d) => d.includes('Max escalation levels: 3 → 4'))).toBe(true);
      expect(diffs.some((d) => d.includes('added [PENDINGFORASSIGNMENT]'))).toBe(true);
      expect(diffs.some((d) => d.includes('L1: 80% → 60%'))).toBe(true);
      expect(diffs.some((d) => d.includes('Complaint-type overrides: 1 added'))).toBe(true);
    });

    it('detects changes when enabledByLevel or fallback array lengths differ from percentages', () => {
      const orig: EscalationConfigData = {
        code: 'DEFAULT',
        maxDepth: 3,
        eligibleStatuses: ['PENDINGATLME'],
        defaultSlaPercentageByLevel: [80, 120, 200],
        defaultSlaByLevel: [3600000, 14400000, 86400000],
        enabledByLevel: [true, true, true],
        overrides: {},
      };

      const draft: EscalationConfigData = {
        ...orig,
        enabledByLevel: [true, true, true, false], // 4 entries, longer than pcts
        defaultSlaByLevel: [3600000, 14400000, 86400000, 100000000],
      };

      const diffs = diffEscalationPolicy(orig, draft);
      expect(diffs.some((d) => d.includes('Automatic triggering per level: L4: Auto OFF → Auto OFF'))).toBe(true);
      expect(diffs.some((d) => d.includes('Absolute fallbacks: L4: 0s → 1d 3h'))).toBe(true);
    });
  });

  describe('normalizeOverride', () => {
    it('returns undefined for empty/falsy overrides', () => {
      expect(normalizeOverride(null)).toBeUndefined();
      expect(normalizeOverride(undefined)).toBeUndefined();
    });

    it('normalizes plain list format [60, 100, 180]', () => {
      const norm = normalizeOverride([60, 100, 180], [80, 120, 200], [true, true, true], [1000, 2000, 3000]);
      expect(norm).toEqual({
        slaPercentageByLevel: [60, 100, 180],
        enabledByLevel: [true, true, true],
        slaByLevel: [1000, 2000, 3000],
      });
    });

    it('normalizes object missing enabledByLevel or slaByLevel', () => {
      const partial = { slaPercentageByLevel: [50, 100] };
      const norm = normalizeOverride(partial, [80, 120, 200], [true, false, true], [1000, 2000, 3000]);
      expect(norm).toEqual({
        slaPercentageByLevel: [50, 100],
        enabledByLevel: [true, false],
        slaByLevel: [1000, 2000],
      });
    });
  });
});
