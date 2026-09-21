import type {
  CatalogueItem,
  EscalationConfigData,
  EscalationLevelOverride,
} from './escalationPolicyTypes';

/**
 * Format milliseconds into human-readable duration, e.g. 3600000 -> "1h", 86400000 -> "1d".
 */
export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  const d = Math.floor(ms / 86_400_000);
  const h = Math.floor((ms % 86_400_000) / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0) parts.push(`${s}s`);
  return parts.join(' ') || `${ms}ms`;
}

/**
 * Computes trigger preview string from base SLA hours and cumulative percentage.
 * e.g. (10h, 60%) -> "6h after creation"
 */
export function computeTriggerPreview(baseSlaHours: number, percentage: number): string {
  if (!baseSlaHours || baseSlaHours <= 0 || !percentage || percentage <= 0) {
    return '—';
  }
  const hours = (baseSlaHours * percentage) / 100;
  const formattedHours = Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
  return `${formattedHours} after complaint creation`;
}

export interface LadderValidationResult {
  valid: boolean;
  pctErrors: (string | null)[];
  fallbackErrors: (string | null)[];
}

/**
 * Validates escalation percentage and absolute fallback ladders.
 * Rules:
 * - Percentages must be positive integers, strictly increasing, and capped at 200.
 * - Absolute fallbacks must be non-negative integers, strictly increasing.
 */
export function validateLadder(
  pcts: number[],
  fallbacks: number[]
): LadderValidationResult {
  const pctErrors: (string | null)[] = pcts.map(() => null);
  const fallbackErrors: (string | null)[] = fallbacks.map(() => null);
  let valid = true;

  for (let i = 0; i < pcts.length; i++) {
    const val = pcts[i];
    if (val == null || Number.isNaN(val) || val <= 0) {
      pctErrors[i] = 'Must be greater than 0';
      valid = false;
    } else if (!Number.isInteger(val)) {
      pctErrors[i] = 'Must be a whole number (integer)';
      valid = false;
    } else if (val > 200) {
      pctErrors[i] = 'Cannot exceed 200%';
      valid = false;
    } else if (i > 0 && val <= pcts[i - 1]) {
      pctErrors[i] = `Must be greater than L${i} (${pcts[i - 1]}%)`;
      valid = false;
    }
  }

  for (let i = 0; i < fallbacks.length; i++) {
    const val = fallbacks[i];
    if (val == null || Number.isNaN(val) || val < 0) {
      fallbackErrors[i] = 'Cannot be negative';
      valid = false;
    } else if (!Number.isInteger(val)) {
      fallbackErrors[i] = 'Must be a whole number of milliseconds';
      valid = false;
    } else if (i > 0 && val <= fallbacks[i - 1]) {
      fallbackErrors[i] = `Must be greater than L${i} (${fallbacks[i - 1]} ms)`;
      valid = false;
    }
  }

  return { valid, pctErrors, fallbackErrors };
}

/**
 * Determines whether an MDMS ComplaintHierarchy record is a leaf row.
 */
export function isLeafHierarchyRow(data: Record<string, unknown>): boolean {
  return data.department != null || data.slaHours != null;
}

/**
 * Builds localized or fallback breadcrumb path for a node by walking up parentCode.
 */
export function buildBreadcrumb(
  code: string,
  nodeMap: Map<string, Record<string, unknown>>,
  maxDepth = 10
): string {
  const parts: string[] = [];
  let currentCode: string | undefined = code;
  let depth = 0;
  const visited = new Set<string>();

  while (currentCode && depth < maxDepth && !visited.has(currentCode)) {
    visited.add(currentCode);
    const node = nodeMap.get(currentCode);
    if (!node) {
      parts.unshift(currentCode);
      break;
    }
    const name = String(node.name || node.code || currentCode);
    parts.unshift(name);
    currentCode = typeof node.parentCode === 'string' && node.parentCode.trim() ? node.parentCode.trim() : undefined;
    depth++;
  }

  return parts.join(' › ');
}

export interface HierarchyRecordLike {
  id?: string;
  uniqueIdentifier?: string;
  isActive?: boolean;
  data?: Record<string, unknown>;
}

/**
 * Normalizes an override value which may be:
 * - undefined or null
 * - a plain array of percentages: e.g. [60, 100, 180]
 * - an object missing slaPercentageByLevel, enabledByLevel, or slaByLevel
 */
export function normalizeOverride(
  rawOverride: unknown,
  defaultPcts: number[] = [80, 120, 200],
  defaultEnabled: boolean[] = [true, true, true],
  defaultFallbacks: number[] = [3600000, 14400000, 86400000]
): EscalationLevelOverride | undefined {
  if (!rawOverride) return undefined;

  // Plain list format accepted by backend: [60, 100, 180]
  if (Array.isArray(rawOverride)) {
    const pcts = rawOverride.map((n) => Number(n) || 0);
    return {
      slaPercentageByLevel: pcts,
      enabledByLevel: defaultEnabled.slice(0, pcts.length),
      slaByLevel: defaultFallbacks.slice(0, pcts.length),
    };
  }

  if (typeof rawOverride === 'object') {
    const obj = rawOverride as Record<string, unknown>;
    const pcts = Array.isArray(obj.slaPercentageByLevel)
      ? (obj.slaPercentageByLevel as number[]).map((n) => Number(n) || 0)
      : [...defaultPcts];

    const enabled = Array.isArray(obj.enabledByLevel)
      ? (obj.enabledByLevel as boolean[])
      : defaultEnabled.slice(0, pcts.length);

    const fallbacks = Array.isArray(obj.slaByLevel)
      ? (obj.slaByLevel as number[]).map((n) => Number(n) || 0)
      : defaultFallbacks.slice(0, pcts.length);

    while (enabled.length < pcts.length) {
      enabled.push(defaultEnabled[enabled.length] ?? true);
    }
    while (fallbacks.length < pcts.length) {
      fallbacks.push(defaultFallbacks[fallbacks.length] ?? 3600000);
    }

    return {
      slaPercentageByLevel: pcts,
      enabledByLevel: enabled.slice(0, pcts.length),
      slaByLevel: fallbacks.slice(0, pcts.length),
    };
  }

  return undefined;
}

/**
 * Builds the complete fileable complaint types catalogue joined with overrides,
 * matching the complaint-filing leaf selection rule (leaves + terminal nodes).
 */
export function buildHierarchyCatalogue(
  records: HierarchyRecordLike[],
  overrides: Record<string, unknown> = {},
  defaults?: {
    percentages?: number[];
    enabledByLevel?: boolean[];
    fallbacks?: number[];
  }
): { catalogue: CatalogueItem[]; orphanedOverrides: CatalogueItem[] } {
  const activeRecords = records.filter((r) => r.isActive !== false && r.data);
  const nodeMap = new Map<string, Record<string, unknown>>();
  const hasChildren = new Set<string>();

  for (const r of activeRecords) {
    const d = r.data || {};
    const code = String(d.code ?? r.uniqueIdentifier ?? '');
    if (code) {
      nodeMap.set(code, d);
      if (d.parentCode) {
        hasChildren.add(String(d.parentCode));
      }
    }
  }

  // An active row is fileable if it carries leaf fields (dept/sla) OR is a terminal node
  const fileableRecords = activeRecords.filter((r) => {
    const d = r.data || {};
    const code = String(d.code ?? r.uniqueIdentifier ?? '');
    return isLeafHierarchyRow(d) || !hasChildren.has(code);
  });

  const catalogue: CatalogueItem[] = [];
  const coveredCodes = new Set<string>();

  for (const r of fileableRecords) {
    const d = r.data || {};
    const code = String(d.code ?? r.uniqueIdentifier ?? '');
    if (!code) continue;

    coveredCodes.add(code);
    const name = String(d.name || d.serviceName || code);
    const department = String(d.department || '');
    const departments = Array.isArray(d.departments) ? (d.departments as string[]) : undefined;
    const slaHours = typeof d.slaHours === 'number' ? d.slaHours : 0;
    const path = buildBreadcrumb(code, nodeMap);
    const override = normalizeOverride(
      overrides[code],
      defaults?.percentages,
      defaults?.enabledByLevel,
      defaults?.fallbacks
    );

    catalogue.push({
      code,
      name,
      department,
      departments,
      slaHours,
      path,
      parentCode: typeof d.parentCode === 'string' ? d.parentCode : undefined,
      levelCode: typeof d.levelCode === 'string' ? d.levelCode : undefined,
      override,
      isOrphaned: false,
    });
  }

  // Sort catalogue alphabetically by breadcrumb path
  catalogue.sort((a, b) => a.path.localeCompare(b.path));

  // Find any orphaned overrides (keys present in overrides but missing from active fileable catalogue)
  const orphanedOverrides: CatalogueItem[] = [];
  for (const [code, rawOverride] of Object.entries(overrides)) {
    if (!coveredCodes.has(code)) {
      const override = normalizeOverride(
        rawOverride,
        defaults?.percentages,
        defaults?.enabledByLevel,
        defaults?.fallbacks
      );
      orphanedOverrides.push({
        code,
        name: code,
        department: '—',
        slaHours: 0,
        path: code,
        override,
        isOrphaned: true,
      });
    }
  }

  orphanedOverrides.sort((a, b) => a.code.localeCompare(b.code));

  return { catalogue, orphanedOverrides };
}

/**
 * Generates human-readable diff bullet points between original policy and draft.
 */
export function diffEscalationPolicy(
  original: EscalationConfigData,
  draft: EscalationConfigData
): string[] {
  const diffs: string[] = [];

  if (original.maxDepth !== draft.maxDepth) {
    diffs.push(`Max escalation levels: ${original.maxDepth} → ${draft.maxDepth}`);
  }

  // Eligible statuses
  const origStatuses = new Set(original.eligibleStatuses || []);
  const draftStatuses = new Set(draft.eligibleStatuses || []);
  const addedStatuses = [...draftStatuses].filter((s) => !origStatuses.has(s));
  const removedStatuses = [...origStatuses].filter((s) => !draftStatuses.has(s));
  if (addedStatuses.length > 0 || removedStatuses.length > 0) {
    const parts: string[] = [];
    if (addedStatuses.length > 0) parts.push(`added [${addedStatuses.join(', ')}]`);
    if (removedStatuses.length > 0) parts.push(`removed [${removedStatuses.join(', ')}]`);
    diffs.push(`Automatic escalation states: ${parts.join(', ')}`);
  }

  // Ladder SLA percentages
  const origPcts = original.defaultSlaPercentageByLevel || [];
  const draftPcts = draft.defaultSlaPercentageByLevel || [];
  const pctChanges: string[] = [];
  const maxLen = Math.max(origPcts.length, draftPcts.length);
  for (let i = 0; i < maxLen; i++) {
    const o = origPcts[i];
    const d = draftPcts[i];
    if (o !== d) {
      pctChanges.push(`L${i + 1}: ${o ?? '—'}% → ${d ?? '—'}%`);
    }
  }
  if (pctChanges.length > 0) {
    diffs.push(`Default SLA % thresholds: ${pctChanges.join(', ')}`);
  }

  // Enabled flags
  const origEnabled = original.enabledByLevel || [];
  const draftEnabled = draft.enabledByLevel || [];
  const enabledChanges: string[] = [];
  const maxLenEnabled = Math.max(origEnabled.length, draftEnabled.length);
  for (let i = 0; i < maxLenEnabled; i++) {
    const o = origEnabled[i];
    const d = draftEnabled[i];
    if (o !== d) {
      enabledChanges.push(`L${i + 1}: ${o ? 'Auto ON' : 'Auto OFF'} → ${d ? 'Auto ON' : 'Auto OFF'}`);
    }
  }
  if (enabledChanges.length > 0) {
    diffs.push(`Automatic triggering per level: ${enabledChanges.join(', ')}`);
  }

  // Fallbacks
  const origFb = original.defaultSlaByLevel || [];
  const draftFb = draft.defaultSlaByLevel || [];
  const fbChanges: string[] = [];
  const maxLenFb = Math.max(origFb.length, draftFb.length);
  for (let i = 0; i < maxLenFb; i++) {
    const o = origFb[i];
    const d = draftFb[i];
    if (o !== d) {
      fbChanges.push(`L${i + 1}: ${formatDurationMs(o ?? 0)} → ${formatDurationMs(d ?? 0)}`);
    }
  }
  if (fbChanges.length > 0) {
    diffs.push(`Absolute fallbacks: ${fbChanges.join(', ')}`);
  }

  // Overrides count
  const origOverrides = original.overrides || {};
  const draftOverrides = draft.overrides || {};
  const origKeys = new Set(Object.keys(origOverrides));
  const draftKeys = new Set(Object.keys(draftOverrides));
  const addedOverrides = [...draftKeys].filter((k) => !origKeys.has(k));
  const removedOverrides = [...origKeys].filter((k) => !draftKeys.has(k));
  let modifiedOverridesCount = 0;
  for (const k of draftKeys) {
    if (origKeys.has(k)) {
      if (JSON.stringify(origOverrides[k]) !== JSON.stringify(draftOverrides[k])) {
        modifiedOverridesCount++;
      }
    }
  }

  if (addedOverrides.length > 0 || removedOverrides.length > 0 || modifiedOverridesCount > 0) {
    const overrideParts: string[] = [];
    if (addedOverrides.length > 0) overrideParts.push(`${addedOverrides.length} added`);
    if (modifiedOverridesCount > 0) overrideParts.push(`${modifiedOverridesCount} updated`);
    if (removedOverrides.length > 0) overrideParts.push(`${removedOverrides.length} removed`);
    diffs.push(`Complaint-type overrides: ${overrideParts.join(', ')}`);
  }

  if (diffs.length === 0) {
    diffs.push('No functional policy changes detected.');
  }

  return diffs;
}
