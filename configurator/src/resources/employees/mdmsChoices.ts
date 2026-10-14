import { useMemo } from 'react';
import { useGetList } from 'ra-core';

export interface Choice {
  value: string;
  label: string;
}

const titleCase = (code: string) =>
  code.toLowerCase().split(/[_\s]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

/**
 * ours#850: select choices from an MDMS master's rows - active rows only, value = code, label = the row's name (else
 * the code, title-cased) - or `fallback` when the master has no usable row (empty, unreadable, still loading).
 */
export function choicesFromMdms(rows: ReadonlyArray<Record<string, unknown>> | undefined, fallback: Choice[], always: string[] = []): Choice[] {
  const seen = new Set<string>();
  const choices: Choice[] = [];
  for (const row of rows ?? []) {
    if (row.active === false) continue;
    const code = String(row.code ?? row.id ?? '').trim();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    const name = typeof row.name === 'string' && row.name.trim() ? row.name.trim() : titleCase(code);
    choices.push({ value: code, label: name });
  }
  if (!choices.length) return fallback;
  // `always`: fallback values the form itself acts on (Employee Edit deactivates on INACTIVE), offered even when the
  // master does not list them - else the screen loses the action (nightly 2026-10-14 pE12 / pE13 / XM3).
  for (const v of always) if (!seen.has(v)) { const f = fallback.find((c) => c.value === v); if (f) choices.push(f); }
  return choices;
}

export function useMdmsChoices(resource: string, fallback: Choice[], always: string[] = []): Choice[] {
  const { data } = useGetList(resource, { pagination: { page: 1, perPage: 200 }, sort: { field: 'code', order: 'ASC' } });
  const key = always.join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => choicesFromMdms(data as Record<string, unknown>[] | undefined, fallback, always), [data, fallback, key]);
}

/**
 * The Status an Edit form shows for an employee record: a deactivated employee (isActive false) reads INACTIVE even
 * when HRMS kept employeeStatus EMPLOYED (the deactivation writes isActive, not the status). Showing EMPLOYED there
 * also meant any save of the form re-activated the person (pE13, nightly 2026-10-14).
 */
export function employeeStatusShown(record: { isActive?: unknown; employeeStatus?: unknown } | undefined): string | undefined {
  const s = typeof record?.employeeStatus === 'string' ? record.employeeStatus : undefined;
  if (record?.isActive === false && s !== 'INACTIVE' && s !== 'RETIRED') return 'INACTIVE';
  return s;
}
