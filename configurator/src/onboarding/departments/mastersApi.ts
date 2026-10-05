import { localizationService, mdmsService, MDMS_SCHEMAS } from '@/api';
import type { MdmsRecord } from '@/api/types';

/**
 * Departments and designations for the Departments step, read and written as
 * mdms-v2 records at the workspace tenant. Every write also sets the record's
 * label, which is what the citizen and employee apps show.
 */

export type MasterKind = 'department' | 'designation';

export interface MasterInput {
  code: string;
  name: string;
  /** Designations only: the departments it belongs to. */
  departments?: string[];
}

const SCHEMA: Record<MasterKind, string> = {
  department: MDMS_SCHEMAS.DEPARTMENT,
  designation: MDMS_SCHEMAS.DESIGNATION,
};

/** A code people can type and the platform accepts: capitals, digits and underscores. */
export const CODE_PATTERN = /^[A-Z0-9_]+$/;

/** "Roads & Infrastructure" suggests ROADS_INFRASTRUCTURE. */
export function suggestCode(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30)
    .replace(/_+$/g, '');
}

export function recordName(record: MdmsRecord): string {
  const name = (record.data as { name?: unknown }).name;
  return typeof name === 'string' && name ? name : record.uniqueIdentifier;
}

export function recordDepartments(record: MdmsRecord): string[] {
  const departments = (record.data as { department?: unknown }).department;
  return Array.isArray(departments) ? departments.filter((code): code is string => typeof code === 'string') : [];
}

/**
 * The workspace's active records of one kind, oldest first. mdms-v2 falls back
 * to the state root's rows when a city has none. Those belong to the whole
 * state: a picker offers them (HRMS takes a state department for a city
 * employee), but where records are edited or removed, pass `ownOnly`.
 */
export async function listMasters(
  tenantId: string,
  kind: MasterKind,
  { ownOnly = false }: { ownOnly?: boolean } = {},
): Promise<MdmsRecord[]> {
  const records = await mdmsService.searchRecords(tenantId, SCHEMA[kind], { limit: 5000 });
  return records
    .filter((record) => (!ownOnly || record.tenantId === tenantId) && record.isActive !== false)
    .sort((a, b) => (a.auditDetails?.createdTime ?? 0) - (b.auditDetails?.createdTime ?? 0));
}

function dataFor(kind: MasterKind, input: MasterInput, base: Record<string, unknown> = {}): Record<string, unknown> {
  const data: Record<string, unknown> = { ...base, code: input.code, name: input.name.trim(), active: true };
  if (kind === 'designation') {
    data.department = input.departments ?? [];
    // Required by the schema; the name reads well where no description was given.
    if (typeof data.description !== 'string' || !data.description) data.description = input.name.trim();
  }
  return data;
}

async function label(tenantId: string, kind: MasterKind, entries: MasterInput[]): Promise<void> {
  const pairs = entries.map(({ code, name }) => ({ code, name: name.trim() }));
  if (kind === 'department') await localizationService.uploadDepartmentLocalizations(tenantId, pairs, 'en_IN');
  else await localizationService.uploadDesignationLocalizations(tenantId, pairs, 'en_IN');
}

async function refreshLabels(): Promise<void> {
  await localizationService.cacheBust().catch(() => {
    // Labels refresh on the cache's own schedule instead.
  });
}

/**
 * Create one record, or restore it when a removed record still holds the code.
 * Passing `existing` edits that record (its code cannot change).
 */
export async function saveMaster(
  tenantId: string,
  kind: MasterKind,
  input: MasterInput,
  existing?: MdmsRecord,
): Promise<MdmsRecord> {
  let saved: MdmsRecord;
  if (existing) {
    saved = await mdmsService.update(existing, dataFor(kind, { ...input, code: existing.uniqueIdentifier }, existing.data));
  } else {
    // A record that still holds the code (removed, or written by a save that
    // failed before its label) is brought back and refreshed, not created again.
    const all = await mdmsService.searchRecords(tenantId, SCHEMA[kind], { limit: 5000 });
    const held = all.find((record) => record.uniqueIdentifier === input.code && record.tenantId === tenantId);
    saved = held
      ? await mdmsService.setActive(held, true, dataFor(kind, input, held.data))
      : await mdmsService.create(tenantId, SCHEMA[kind], input.code, dataFor(kind, input));
  }
  await label(tenantId, kind, [{ ...input, code: existing?.uniqueIdentifier ?? input.code }]);
  await refreshLabels();
  return saved;
}

export async function removeMaster(record: MdmsRecord): Promise<void> {
  await mdmsService.setActive(record, false);
}

export interface ImportResult {
  created: number;
  skipped: number;
  failed: { code: string; error: string }[];
}

/**
 * Bring in a parsed sheet. Codes the workspace already has are left alone, so
 * uploading the same file twice adds nothing.
 */
export async function importMasters(
  tenantId: string,
  kind: MasterKind,
  rows: MasterInput[],
  existingCodes: Set<string>,
): Promise<ImportResult> {
  const result: ImportResult = { created: 0, skipped: 0, failed: [] };
  const created: MasterInput[] = [];
  for (const row of rows) {
    if (existingCodes.has(row.code)) {
      result.skipped += 1;
      continue;
    }
    try {
      await mdmsService.create(tenantId, SCHEMA[kind], row.code, dataFor(kind, row));
      created.push(row);
      result.created += 1;
    } catch (err) {
      result.failed.push({ code: row.code, error: err instanceof Error ? err.message : String(err) });
    }
  }
  if (created.length) {
    await label(tenantId, kind, created);
    await refreshLabels();
  }
  return result;
}
