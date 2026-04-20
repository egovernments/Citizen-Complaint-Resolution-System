import { useQuery } from '@tanstack/react-query';
import { digitClient } from '@/providers/bridge';
import type { SchemaDefinition } from '@/admin/schemaUtils';

interface UseSchemaDefinitionResult {
  definition: SchemaDefinition | null;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Fetch the MDMS v2 JSON Schema definition for a given schema code.
 * Results are cached with infinite staleTime — schemas don't change during a session.
 */
export function useSchemaDefinition(schemaCode?: string): UseSchemaDefinitionResult {
  const tenantId = digitClient.stateTenantId;

  const { data, isLoading, error } = useQuery<SchemaDefinition | null, Error>({
    queryKey: ['mdms-schema-definition', tenantId, schemaCode],
    queryFn: async () => {
      if (!schemaCode || !tenantId) return null;
      const results = await digitClient.mdmsSchemaSearch(tenantId, [schemaCode]);
      if (results.length === 0) return null;
      const schemaDef = results[0] as Record<string, unknown>;
      return (schemaDef.definition as SchemaDefinition) ?? null;
    },
    enabled: !!schemaCode && !!tenantId,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  return {
    definition: data ?? null,
    isLoading,
    error: error ?? null,
  };
}
