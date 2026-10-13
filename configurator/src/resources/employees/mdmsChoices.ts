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
export function choicesFromMdms(rows: ReadonlyArray<Record<string, unknown>> | undefined, fallback: Choice[]): Choice[] {
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
  return choices.length ? choices : fallback;
}

export function useMdmsChoices(resource: string, fallback: Choice[]): Choice[] {
  const { data } = useGetList(resource, { pagination: { page: 1, perPage: 200 }, sort: { field: 'code', order: 'ASC' } });
  return useMemo(() => choicesFromMdms(data as Record<string, unknown>[] | undefined, fallback), [data, fallback]);
}
