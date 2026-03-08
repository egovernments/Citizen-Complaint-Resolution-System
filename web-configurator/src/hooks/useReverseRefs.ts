import { useQuery } from '@tanstack/react-query';
import { digitClient, getResourceBySchema } from '@/providers/bridge';
import type { RefSchemaEntry } from '@/admin/schemaUtils';

export interface ReverseRef {
  fromSchema: string;
  fromResource: string;
  fieldPath: string;
  fromLabel: string;
}

interface UseReverseRefsResult {
  refs: ReverseRef[];
  isLoading: boolean;
}

/**
 * Fetch all MDMS schema definitions, then find which schemas reference
 * the given schemaCode via their x-ref-schema entries.
 * Cached with infinite staleTime.
 */
export function useReverseRefs(schemaCode?: string): UseReverseRefsResult {
  const tenantId = digitClient.stateTenantId;

  const { data: allSchemas, isLoading: schemasLoading } = useQuery<Record<string, unknown>[], Error>({
    queryKey: ['mdms-all-schemas', tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      return digitClient.mdmsSchemaSearch(tenantId);
    },
    enabled: !!tenantId && !!schemaCode,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  if (!schemaCode || schemasLoading || !allSchemas) {
    return { refs: [], isLoading: schemasLoading };
  }

  const refs: ReverseRef[] = [];
  for (const schemaDef of allSchemas) {
    const code = schemaDef.code as string | undefined;
    const definition = schemaDef.definition as Record<string, unknown> | undefined;
    if (!code || !definition) continue;

    const xRefSchema = definition['x-ref-schema'] as RefSchemaEntry[] | undefined;
    if (!xRefSchema || !Array.isArray(xRefSchema)) continue;

    for (const ref of xRefSchema) {
      if (ref.schemaCode === schemaCode) {
        const fromResource = getResourceBySchema(code) ?? '';
        refs.push({
          fromSchema: code,
          fromResource,
          fieldPath: ref.fieldPath,
          fromLabel: fromResource
            ? fromResource.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
            : code,
        });
      }
    }
  }

  return { refs, isLoading: false };
}
