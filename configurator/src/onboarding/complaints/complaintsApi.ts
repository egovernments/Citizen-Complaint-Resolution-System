import { localizationService, mdmsService } from '@/api';
import type { MdmsRecord } from '@/api/types';
import { KNOWN_LEVEL_LABELS, toPascal } from '@/utils/excelParser';
import { labelLocales } from '../labelLocales';

/**
 * Complaint types built from scratch: types, each handled by one department,
 * with optional subtypes, and a resolution time: the workspace default, or the
 * type's own (a subtype follows its type unless it was saved with its own). Saved as
 * the same RAINMAKER-PGR.ComplaintHierarchy the spreadsheet route writes: a
 * two-level PGR hierarchy whose rows people file against (every subtype, or a
 * type that has none) carry the department and slaHours.
 */

export const HIERARCHY_TYPE = 'PGR';
export const LEVELS = ['COMPLAINT_TYPE', 'SUB_TYPE'] as const;
/** Display labels stored on the definition's levels; the level codes stay as they are. */
const LEVEL_LABELS: Record<(typeof LEVELS)[number], string> = {
  COMPLAINT_TYPE: KNOWN_LEVEL_LABELS.COMPLAINT_TYPE,
  SUB_TYPE: KNOWN_LEVEL_LABELS.SUB_TYPE,
};
const DEFINITION_SCHEMA = 'RAINMAKER-PGR.ComplaintHierarchyDefinition';
const HIERARCHY_SCHEMA = 'RAINMAKER-PGR.ComplaintHierarchy';
export const DEFAULT_SLA_HOURS = 72;

export interface DraftSubtype {
  /** Set once saved; a rename keeps it. */
  code?: string;
  name: string;
  /** Its own resolution time, kept when it was saved with one that differs from its type's. Unset: the type's. */
  slaHours?: number;
}

export interface DraftType {
  code?: string;
  name: string;
  department: string;
  subtypes: DraftSubtype[];
  /** The type's own resolution time. Unset: the workspace default. */
  slaHours?: number;
}

export interface ComplaintDraft {
  types: DraftType[];
  /** The default resolution time, for every type without its own. */
  slaHours: number;
}

/** The hours a row people file against gets: the subtype's own, else its type's, else the default. */
export function resolutionHours(draft: ComplaintDraft, type: DraftType, subtype?: DraftSubtype): number {
  return subtype?.slaHours ?? type.slaHours ?? draft.slaHours;
}

/** Whether some of the type's subtypes keep their own resolution time. */
export function hasMixedHours(type: DraftType): boolean {
  return type.subtypes.some((subtype) => subtype.slaHours !== undefined);
}

/** The most common value, the earliest on a tie. */
function mostCommon(values: number[]): number | undefined {
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: number | undefined;
  for (const [value, count] of counts) if (best === undefined || count > counts.get(best)!) best = value;
  return best;
}

export type LoadedComplaints =
  | { editable: true; draft: ComplaintDraft; records: MdmsRecord[]; hasDefinition: boolean }
  /**
   * Set up some other way (a spreadsheet with its own levels): shown, not edited, here. `routes` is
   * each leaf's name and department, so a department nobody can take can be named with its categories.
   */
  | { editable: false; leafCount: number; levels: string[]; departments: string[]; routes: ComplaintRoute[] };

/** A complaint category people file against, and the department code it goes to ('' when none). */
export interface ComplaintRoute {
  name: string;
  department: string;
}

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
  // The workspace's own definition when it has one, even a removed one: a removed one means it has
  // none, rather than the state root's (#2806, "Remove and upload again").
  const pgrDefinitions = definitions.filter((record) => text(dataOf(record).hierarchyType) === HIERARCHY_TYPE);
  const ownDefinitions = pgrDefinitions.filter((record) => record.tenantId === tenantId);
  const definition = (ownDefinitions.length > 0 ? ownDefinitions : pgrDefinitions).find((record) => record.isActive !== false);
  const definedLevels = definition
    ? ((dataOf(definition).levels as { levelCode?: string }[] | undefined) ?? []).map((level) => level.levelCode ?? '')
    : [];
  const active = records.filter((record) => record.isActive !== false && text(dataOf(record).hierarchyType) === HIERARCHY_TYPE);

  if (definition && definedLevels.join('|') !== LEVELS.join('|')) {
    const leafCount = active.filter((record) => dataOf(record).department != null || dataOf(record).slaHours != null).length;
    // A leaf is a row no other row names as its parent; complaints filed on it go to its department.
    const parents = new Set(active.map((record) => text(dataOf(record).parentCode)));
    const routes = active
      .filter((record) => !parents.has(codeOf(record)))
      .map((record) => ({ name: text(dataOf(record).name) || codeOf(record), department: text(dataOf(record).department) }));
    const departments = routes.map((route) => route.department).filter(Boolean);
    return { editable: false, leafCount, levels: definedLevels, departments: Array.from(new Set(departments)), routes };
  }

  const byOrder = (a: MdmsRecord, b: MdmsRecord) => Number(dataOf(a).order ?? 0) - Number(dataOf(b).order ?? 0);
  const typeRows = active.filter((record) => dataOf(record).levelCode === LEVELS[0]).sort(byOrder);
  const subtypeRows = active.filter((record) => dataOf(record).levelCode === LEVELS[1]).sort(byOrder);
  const hoursOf = (record: MdmsRecord) => {
    const hours = Number(dataOf(record).slaHours);
    return hours > 0 ? hours : undefined;
  };
  const defined = (values: (number | undefined)[]) => values.filter((hours): hours is number => hours !== undefined);
  const subtypesOf = (row: MdmsRecord) => subtypeRows.filter((sub) => dataOf(sub).parentCode === codeOf(row));
  // Hours live on the rows people file against. A type's are its subtypes' most common (or its own as
  // a leaf); the types' most common becomes the default. A type or subtype that differs keeps its own,
  // so a save writes back what it loaded.
  const hoursByType = new Map(
    typeRows.map((row) => {
      const subtypes = subtypesOf(row);
      return [row, mostCommon(defined(subtypes.length ? subtypes.map(hoursOf) : [hoursOf(row)]))] as const;
    }),
  );
  const defaultHours = mostCommon(defined([...hoursByType.values()])) ?? DEFAULT_SLA_HOURS;

  const types: DraftType[] = typeRows.map((row) => {
    const subtypes = subtypesOf(row);
    const department = text(dataOf(row).department) || text(subtypes.map((sub) => dataOf(sub).department).find(Boolean));
    const typeHours = hoursByType.get(row);
    const own = typeHours !== undefined && typeHours !== defaultHours ? typeHours : undefined;
    const effective = own ?? defaultHours;
    return {
      code: codeOf(row),
      name: text(dataOf(row).name) || codeOf(row),
      department,
      subtypes: subtypes.map((sub) => {
        const hours = hoursOf(sub);
        return { code: codeOf(sub), name: text(dataOf(sub).name) || codeOf(sub), ...(hours !== undefined && hours !== effective && { slaHours: hours }) };
      }),
      ...(own !== undefined && { slaHours: own }),
    };
  });

  return {
    editable: true,
    draft: { types, slaHours: defaultHours },
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
        ...(leaf ? { department: type.department, slaHours: resolutionHours(draft, type), keywords: '' } : {}),
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
          slaHours: resolutionHours(draft, type, sub),
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
  // Re-read before creating: a save whose step update then failed has already created the definition, and the page
  // still holds the stale `hasDefinition` from when it loaded, so a blind create fails as a duplicate on the retry.
  // A removed one (a spreadsheet's, after "Remove and upload again") keeps its key taken, so it is restored
  // with these levels instead.
  const definition = hasDefinition
    ? undefined
    : (await mdmsService.searchRecords(tenantId, DEFINITION_SCHEMA).catch(() => [] as MdmsRecord[])).find(
        (record) => record.tenantId === tenantId && text(dataOf(record).hierarchyType) === HIERARCHY_TYPE,
      );
  const definitionData = {
    hierarchyType: HIERARCHY_TYPE,
    active: true,
    levels: LEVELS.map((levelCode, index) => ({
      levelCode,
      order: index + 1,
      parentLevel: index === 0 ? null : LEVELS[index - 1],
      isFreeText: false,
      isLeafServiceCode: index === LEVELS.length - 1,
      label: LEVEL_LABELS[levelCode],
    })),
  };
  if (!hasDefinition && !definition) await mdmsService.create(tenantId, DEFINITION_SCHEMA, HIERARCHY_TYPE, definitionData);
  else if (definition?.isActive === false) await mdmsService.setActive(definition, true, definitionData);
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

  const labels = rows.map((row) => ({ serviceCode: row.code, name: text(row.data.name), department: text(row.data.department) || undefined }));
  for (const locale of await labelLocales(tenantId)) {
    await localizationService.uploadComplaintTypeLocalizations(tenantId, labels, locale).catch(() => undefined);
  }
  await localizationService.cacheBust().catch(() => undefined);

  return rows.filter((row) => row.data.slaHours != null).length;
}

/**
 * Write a hierarchy built from a spreadsheet to the workspace's own tenant: the definition and every
 * row, created where missing, restored where removed (mdms-v2 keeps a removed row's key taken), and
 * updated where they differ. Rows the sheet doesn't name are left as they are.
 */
export async function writeSheetHierarchy(
  tenantId: string,
  hierarchyType: string,
  definition: Record<string, unknown>,
  rows: { code: string; data: Record<string, unknown> }[],
): Promise<void> {
  const [definitions, existing] = await Promise.all([
    mdmsService.searchRecords(tenantId, DEFINITION_SCHEMA).catch(() => [] as MdmsRecord[]),
    mdmsService.searchRecords(tenantId, HIERARCHY_SCHEMA, { limit: 5000 }),
  ]);
  const own = (record: MdmsRecord) => record.tenantId === tenantId && text(dataOf(record).hierarchyType) === hierarchyType;
  const upsert = async (record: MdmsRecord | undefined, schema: string, key: string, data: Record<string, unknown>) => {
    if (!record) await mdmsService.create(tenantId, schema, key, data);
    else if (record.isActive === false) await mdmsService.setActive(record, true, data);
    else if (!sameData(dataOf(record), data)) await mdmsService.update(record, data);
  };
  await upsert(definitions.find(own), DEFINITION_SCHEMA, hierarchyType, definition);
  const byCode = new Map(existing.filter(own).map((record) => [codeOf(record), record]));
  for (const row of rows) await upsert(byCode.get(row.code), HIERARCHY_SCHEMA, row.code, row.data);
}

/**
 * Undo a spreadsheet hierarchy at the workspace's own tenant, so it can be uploaded again or built
 * by hand: every PGR row is switched off, then the definition, the way management removes a record.
 * The definition goes last, so a removal that fails part-way still shows the sheet's view and can
 * simply be retried. The state root's copy stays: other cities may file against it, and the
 * workspace's apps and the setup check read only its own rows.
 */
export async function removeSheetComplaints(tenantId: string): Promise<void> {
  const [definitions, rows] = await Promise.all([
    mdmsService.searchRecords(tenantId, DEFINITION_SCHEMA),
    mdmsService.searchRecords(tenantId, HIERARCHY_SCHEMA, { limit: 5000 }),
  ]);
  const live = (record: MdmsRecord) =>
    record.tenantId === tenantId && record.isActive !== false && text(dataOf(record).hierarchyType) === HIERARCHY_TYPE;
  for (const record of rows.filter(live)) await mdmsService.setActive(record, false);
  for (const record of definitions.filter(live)) await mdmsService.setActive(record, false);
}
