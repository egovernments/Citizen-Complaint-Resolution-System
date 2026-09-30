import { localizationService, mdmsService } from '@/api';
import type { MdmsRecord } from '@/api/types';
import { toPascal } from '@/utils/excelParser';

/**
 * Complaint types built from scratch: types, each handled by one department,
 * with optional subtypes, and one resolution time for all of them. Saved as
 * the same RAINMAKER-PGR.ComplaintHierarchy the spreadsheet route writes: a
 * two-level PGR hierarchy whose rows people file against (every subtype, or a
 * type that has none) carry the department and slaHours.
 */

export const HIERARCHY_TYPE = 'PGR';
export const LEVELS = ['COMPLAINT_TYPE', 'SUB_TYPE'] as const;
const DEFINITION_SCHEMA = 'RAINMAKER-PGR.ComplaintHierarchyDefinition';
const HIERARCHY_SCHEMA = 'RAINMAKER-PGR.ComplaintHierarchy';
export const DEFAULT_SLA_HOURS = 72;

export interface DraftSubtype {
  /** Set once saved; a rename keeps it. */
  code?: string;
  name: string;
}

export interface DraftType {
  code?: string;
  name: string;
  department: string;
  subtypes: DraftSubtype[];
}

export interface ComplaintDraft {
  types: DraftType[];
  slaHours: number;
}

export type LoadedComplaints =
  | { editable: true; draft: ComplaintDraft; records: MdmsRecord[]; hasDefinition: boolean }
  /** Set up some other way (a spreadsheet with its own levels): shown, not edited, here. */
  | { editable: false; leafCount: number; levels: string[] };

const stateRootOf = (tenantId: string) => tenantId.split('.')[0];
const dataOf = (record: MdmsRecord) => record.data as Record<string, unknown>;
const text = (value: unknown) => (typeof value === 'string' ? value : '');
/**
 * A hierarchy row's own code. mdms-v2 keys these rows by hierarchyType and
 * code ("PGR.StreetLighting"), while parentCode and serviceCode use the bare
 * code, so matching goes by `data.code`, never the uniqueIdentifier.
 */
const codeOf = (record: MdmsRecord) => text(dataOf(record).code) || record.uniqueIdentifier;

export function subtypeCount(draft: ComplaintDraft): number {
  return draft.types.reduce((count, type) => count + type.subtypes.length, 0);
}

export async function loadComplaints(tenantId: string): Promise<LoadedComplaints> {
  const [definitions, searched] = await Promise.all([
    mdmsService.searchRecords(tenantId, DEFINITION_SCHEMA).catch(() => [] as MdmsRecord[]),
    mdmsService.searchRecords(tenantId, HIERARCHY_SCHEMA, { limit: 5000 }),
  ]);
  // mdms-v2 falls back to the state root's rows when a city has none of its
  // own. Those belong to the whole state, so a city workspace edits only its own.
  const records = searched.filter((record) => record.tenantId === tenantId);
  const definition = definitions.find(
    (record) => record.isActive !== false && text(dataOf(record).hierarchyType) === HIERARCHY_TYPE,
  );
  const definedLevels = definition
    ? ((dataOf(definition).levels as { levelCode?: string }[] | undefined) ?? []).map((level) => level.levelCode ?? '')
    : [];
  const active = records.filter((record) => record.isActive !== false && text(dataOf(record).hierarchyType) === HIERARCHY_TYPE);

  if (definition && definedLevels.join('|') !== LEVELS.join('|')) {
    const leafCount = active.filter((record) => dataOf(record).department != null || dataOf(record).slaHours != null).length;
    return { editable: false, leafCount, levels: definedLevels };
  }

  const byOrder = (a: MdmsRecord, b: MdmsRecord) => Number(dataOf(a).order ?? 0) - Number(dataOf(b).order ?? 0);
  const typeRows = active.filter((record) => dataOf(record).levelCode === LEVELS[0]).sort(byOrder);
  const subtypeRows = active.filter((record) => dataOf(record).levelCode === LEVELS[1]).sort(byOrder);
  const leafHours = active.map((record) => Number(dataOf(record).slaHours)).filter((hours) => hours > 0);

  const types: DraftType[] = typeRows.map((row) => {
    const subtypes = subtypeRows.filter((sub) => dataOf(sub).parentCode === codeOf(row));
    const department = text(dataOf(row).department) || text(subtypes.map((sub) => dataOf(sub).department).find(Boolean));
    return {
      code: codeOf(row),
      name: text(dataOf(row).name) || codeOf(row),
      department,
      subtypes: subtypes.map((sub) => ({ code: codeOf(sub), name: text(dataOf(sub).name) || codeOf(sub) })),
    };
  });

  return {
    editable: true,
    draft: { types, slaHours: leafHours[0] ?? DEFAULT_SLA_HOURS },
    records,
    hasDefinition: !!definition,
  };
}

/** A code from the name that nothing else in the hierarchy uses yet. */
function uniqueCode(base: string, taken: Set<string>): string {
  const root = base || 'Complaint';
  let code = root;
  for (let n = 2; taken.has(code); n += 1) code = `${root}${n}`;
  taken.add(code);
  return code;
}

/** Every hierarchy row the draft describes, codes kept where they exist. */
export function rowsFor(draft: ComplaintDraft, existingCodes: Iterable<string>): { code: string; data: Record<string, unknown> }[] {
  const taken = new Set(existingCodes);
  const draftCodes = new Set<string>();
  for (const type of draft.types) {
    if (type.code) draftCodes.add(type.code);
    for (const sub of type.subtypes) if (sub.code) draftCodes.add(sub.code);
  }
  // A code the draft keeps can't be handed to something new.
  draftCodes.forEach((code) => taken.add(code));

  const rows: { code: string; data: Record<string, unknown> }[] = [];
  let order = 0;
  for (const type of draft.types) {
    const typeCode = type.code ?? uniqueCode(toPascal(type.name), taken);
    const leaf = type.subtypes.length === 0;
    order += 1;
    rows.push({
      code: typeCode,
      data: {
        hierarchyType: HIERARCHY_TYPE,
        levelCode: LEVELS[0],
        code: typeCode,
        name: type.name.trim(),
        parentCode: null,
        order,
        active: true,
        path: typeCode,
        // A type with no subtypes is filed against directly, so it carries the leaf fields.
        ...(leaf ? { department: type.department, slaHours: draft.slaHours, keywords: '' } : {}),
      },
    });
    for (const sub of type.subtypes) {
      const subCode = sub.code ?? uniqueCode(toPascal(`${type.name} ${sub.name}`), taken);
      order += 1;
      rows.push({
        code: subCode,
        data: {
          hierarchyType: HIERARCHY_TYPE,
          levelCode: LEVELS[1],
          code: subCode,
          name: sub.name.trim(),
          parentCode: typeCode,
          order,
          active: true,
          path: `${typeCode}.${subCode}`,
          department: type.department,
          slaHours: draft.slaHours,
          keywords: '',
        },
      });
    }
  }
  return rows;
}

/** The fields that make a row something people file against. */
const LEAF_FIELDS = ['department', 'slaHours', 'keywords'];

/**
 * What a row's record should hold: its current data with the row's on top. A
 * type that now has subtypes loses the leaf fields it had as a leaf: digit-ui
 * and the analytics decide "fileable" from exactly those fields.
 */
export function nextData(current: Record<string, unknown>, row: { data: Record<string, unknown> }): Record<string, unknown> {
  const next = { ...current, ...row.data };
  if (row.data.levelCode === LEVELS[0] && !('department' in row.data)) {
    for (const field of LEAF_FIELDS) delete next[field];
  }
  return next;
}

const sameData = (a: Record<string, unknown>, b: Record<string, unknown>) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].every(
    (key) => JSON.stringify(a[key] ?? null) === JSON.stringify(b[key] ?? null),
  );

/**
 * A fingerprint of the server's rows, kept with a local draft: a draft made
 * against rows that have changed since (another admin, another browser) is
 * stale, and saving it would undo their work.
 */
export function rowsFingerprint(records: MdmsRecord[]): string {
  return records
    .map((record) => `${record.id}:${record.isActive !== false}:${record.auditDetails?.lastModifiedTime ?? 0}`)
    .sort()
    .join('|');
}

/**
 * Make one tenant's hierarchy match the rows. At the workspace's own tenant:
 * create, update, restore or deactivate. At the state root (`shared`), where
 * every city's copy lives: only create what is missing and restore what was
 * removed, never change or switch off a row another city may rely on.
 */
async function sync(
  tenantId: string,
  rows: { code: string; data: Record<string, unknown> }[],
  hasDefinition: boolean,
  { shared = false }: { shared?: boolean } = {},
): Promise<void> {
  if (!hasDefinition) {
    await mdmsService.create(tenantId, DEFINITION_SCHEMA, HIERARCHY_TYPE, {
      hierarchyType: HIERARCHY_TYPE,
      active: true,
      levels: LEVELS.map((levelCode, index) => ({
        levelCode,
        order: index + 1,
        parentLevel: index === 0 ? null : LEVELS[index - 1],
        isFreeText: false,
        isLeafServiceCode: index === LEVELS.length - 1,
        label: levelCode,
      })),
    });
  }
  const existing = (await mdmsService.searchRecords(tenantId, HIERARCHY_SCHEMA, { limit: 5000 })).filter(
    (record) => record.tenantId === tenantId && text(dataOf(record).hierarchyType) === HIERARCHY_TYPE,
  );
  const byCode = new Map(existing.map((record) => [codeOf(record), record]));
  const wanted = new Set(rows.map((row) => row.code));

  for (const row of rows) {
    const record = byCode.get(row.code);
    if (!record) await mdmsService.create(tenantId, HIERARCHY_SCHEMA, row.code, row.data);
    else if (record.isActive === false) await mdmsService.setActive(record, true, shared ? undefined : nextData(dataOf(record), row));
    else if (!shared) {
      const next = nextData(dataOf(record), row);
      if (!sameData(dataOf(record), next)) await mdmsService.update(record, next);
    }
  }
  if (shared) return;
  for (const record of existing) {
    if (record.isActive !== false && !wanted.has(codeOf(record))) await mdmsService.setActive(record, false);
  }
}

export async function saveComplaints(
  tenantId: string,
  loaded: Extract<LoadedComplaints, { editable: true }>,
  draft: ComplaintDraft,
): Promise<number> {
  const rows = rowsFor(draft, loaded.records.map(codeOf));
  await sync(tenantId, rows, loaded.hasDefinition);

  // pgr-services validates serviceCode at the state root, so a city keeps a
  // copy there too, as the spreadsheet route does. Not fatal: the city's own
  // copy is what its apps read.
  const stateRoot = stateRootOf(tenantId);
  if (stateRoot !== tenantId) {
    const rootDefinitions = await mdmsService.searchRecords(stateRoot, DEFINITION_SCHEMA).catch(() => [] as MdmsRecord[]);
    await sync(
      stateRoot,
      rows,
      rootDefinitions.some((record) => record.tenantId === stateRoot && text(dataOf(record).hierarchyType) === HIERARCHY_TYPE),
      { shared: true },
    ).catch(() => undefined);
  }

  await localizationService
    .uploadComplaintTypeLocalizations(
      tenantId,
      rows.map((row) => ({ serviceCode: row.code, name: text(row.data.name), department: text(row.data.department) || undefined })),
      'en_IN',
    )
    .catch(() => undefined);
  await localizationService.cacheBust().catch(() => undefined);

  return rows.filter((row) => row.data.slaHours != null).length;
}
