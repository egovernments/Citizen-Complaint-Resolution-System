import { useMemo } from 'react';
import { useGetList } from 'ra-core';
import type { Role } from '@/api/types';

export interface UseRolesLookupResult {
  roles: Role[];
  isLoading: boolean;
  isError: boolean;
  buildRole: (code: string, tenantId: string) => Role;
}

export function useRolesLookup(): UseRolesLookupResult {
  const { data, isLoading, isError } = useGetList('access-roles', {
    pagination: { page: 1, perPage: 500 },
    sort: { field: 'name', order: 'ASC' },
  });

  const roles = useMemo<Role[]>(() => {
    if (!data) return [];
    return data.map((record) => {
      const code = String((record as Record<string, unknown>).code ?? record.id);
      const name = String((record as Record<string, unknown>).name ?? code);
      const descriptionRaw = (record as Record<string, unknown>).description;
      const role: Role = { code, name };
      if (typeof descriptionRaw === 'string') role.description = descriptionRaw;
      return role;
    });
  }, [data]);

  const buildRole = useMemo(() => {
    return (code: string, tenantId: string): Role => {
      const found = roles.find((r) => r.code === code);
      return { code, name: found?.name ?? code, tenantId };
    };
  }, [roles]);

  return { roles, isLoading, isError: Boolean(isError), buildRole };
}
