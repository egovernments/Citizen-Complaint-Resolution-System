import { useMemo } from 'react';
import { DigitList, DigitDatagrid } from '@/admin';
import type { DigitColumn } from '@/admin';
import { useListContext, useResourceContext } from 'ra-core';
import { getResourceConfig, getResourceLabel, getResourceBySchema } from '@/providers/bridge';
import { useSchemaDefinition } from '@/hooks/useSchemaDefinition';
import { generateColumns, getRefMap, generateFilterElements } from './schemaUtils';

export function MdmsResourcePage() {
  const resource = useResourceContext() ?? '';
  const config = getResourceConfig(resource);
  const label = getResourceLabel(resource);
  const { definition } = useSchemaDefinition(config?.schema);

  // Compute refMap once, reused by columns and filters
  const refMap = useMemo(() => {
    if (!definition) return {};
    return getRefMap(definition, getResourceBySchema);
  }, [definition]);

  const schemaColumns = useMemo(() => {
    if (!definition) return null;
    return generateColumns(definition, refMap);
  }, [definition, refMap]);

  // Auto-generate filter elements from schema
  const filterElements = useMemo(() => {
    if (!definition) return undefined;
    return generateFilterElements(definition, refMap);
  }, [definition, refMap]);

  const subtitle = config?.schema ? `Schema: ${config.schema}` : undefined;

  return (
    <DigitList title={label} subtitle={subtitle} filters={filterElements} hasCreate>
      {schemaColumns ? (
        <DigitDatagrid columns={schemaColumns} rowClick="show" />
      ) : (
        <AutoDetectDatagrid />
      )}
    </DigitList>
  );
}

/** Fallback: auto-detect columns from the first record (original behavior) */
function AutoDetectDatagrid() {
  const { data } = useListContext();
  const firstRecord = data?.[0];

  const columns: DigitColumn[] = useMemo(() => {
    if (!firstRecord) return [{ source: 'id', label: 'ID' }];
    return Object.keys(firstRecord as Record<string, unknown>)
      .filter((key) => !key.startsWith('_') && key !== 'id')
      .slice(0, 8)
      .map((key) => ({
        source: key,
        label: key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase()),
      }));
  }, [firstRecord]);

  return <DigitDatagrid columns={columns} rowClick="show" />;
}
