import { useMemo } from 'react';
import { useGetList } from 'ra-core';

export interface GenderChoice {
  value: string;
  label: string;
}

/** `TRANSGENDER` -> `Transgender`, `NOT_STATED` -> `Not stated`. */
function labelFor(code: string): string {
  const words = code.replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Maps `gender-types` (MDMS `common-masters.GenderType`) records to select choices. */
export function toGenderChoices(records: ReadonlyArray<Record<string, unknown>> | undefined): GenderChoice[] {
  return (records ?? [])
    .map((r) => String(r.code ?? r.id ?? ''))
    .filter(Boolean)
    .map((code) => ({ value: code, label: labelFor(code) }));
}

/**
 * The genders offered when creating or editing a person, read from the tenant's
 * `common-masters.GenderType` master so the seed decides them (#2397). The
 * data provider returns active records only, so a deactivated gender drops out.
 */
export function useGenderChoices(): GenderChoice[] {
  const { data } = useGetList('gender-types', {
    pagination: { page: 1, perPage: 100 },
    sort: { field: 'code', order: 'ASC' },
  });
  return useMemo(() => toGenderChoices(data as Record<string, unknown>[] | undefined), [data]);
}
