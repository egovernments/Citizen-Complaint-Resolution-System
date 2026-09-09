import { useMemo } from 'react';
import { useGetList, type RaRecord } from 'ra-core';

export interface EmployeeCandidate {
  uuid: string;
  code: string;
  name: string;
}

interface EmployeeListRecord extends RaRecord {
  uuid?: string;
  code?: string;
  user?: { name?: string };
}

export interface UseEmployeeLookupResult {
  employees: EmployeeCandidate[];
  isLoading: boolean;
  isError: boolean;
}

/** Candidate managers for the "Reporting To" picker, scoped to the given tenant. */
export function useEmployeeLookup(tenantFilter?: { __tenantId: string }): UseEmployeeLookupResult {
  const { data, isLoading, isError } = useGetList<EmployeeListRecord>('employees', {
    pagination: { page: 1, perPage: 500 },
    sort: { field: 'code', order: 'ASC' },
    filter: tenantFilter,
  });

  const employees = useMemo<EmployeeCandidate[]>(() => {
    if (!data) return [];
    const out: EmployeeCandidate[] = [];
    for (const record of data) {
      // hrmsGetList's normalizeRecord doesn't flatten user.name to a top-level
      // `name`, so read the nested field directly (see EmployeeList.tsx).
      const uuid = record.uuid ?? (typeof record.id === 'string' ? record.id : undefined);
      if (!uuid) continue;
      const code = record.code ?? uuid;
      out.push({ uuid, code, name: record.user?.name ?? code });
    }
    return out;
  }, [data]);

  return { employees, isLoading, isError: Boolean(isError) };
}
