import { useMemo } from 'react';
import { DigitList, DigitDatagrid } from '@/admin';
import type { DigitColumn } from '@/admin';
import { useListContext, useResourceContext } from 'ra-core';
import { getResourceConfig, getResourceBySchema } from '@/providers/bridge';
import { useResourceLabel } from '@/providers/useResourceLabel';
import { useSchemaDefinition } from '@/hooks/useSchemaDefinition';
import { generateColumns, getRefMap, generateFilterElements, applyDescriptorListWidgets } from './schemaUtils';
import { useMastersCapability } from '@/hooks/useMastersCapability';
import { ReadOnlyResourceNotice } from './ReadOnlyResourceNotice';
import { getDescriptor, type SchemaDescriptor } from './schemaDescriptors';

export function MdmsResourcePage() {
  const resource = useResourceContext() ?? '';
  const config = getResourceConfig(resource);
  const label = useResourceLabel()(resource);
  const { canEditResource } = useMastersCapability();
  const { definition } = useSchemaDefinition(config?.schema);
  // Per-schema list-cell overrides. Applied to BOTH column sources below,
  // because which one runs depends on whether this deployment can serve the
  // schema definition — and the JSON dump this fixes shows up in either.
  const descriptor = getDescriptor(config?.schema);

  // Compute refMap once, reused by columns and filters
  const refMap = useMemo(() => {
    if (!definition) return {};
    return getRefMap(definition, getResourceBySchema);
  }, [definition]);

  const schemaColumns = useMemo(() => {
    if (!definition) return null;
    return applyDescriptorListWidgets(generateColumns(definition, refMap), descriptor);
  }, [definition, refMap, descriptor]);

  // Auto-generate filter elements from schema
  const filterElements = useMemo(() => {
    if (!definition) return undefined;
    return generateFilterElements(definition, refMap);
  }, [definition, refMap]);

  const subtitle = config?.schema ? `Schema: ${config.schema}` : undefined;

  return (
    <>
      <ReadOnlyResourceNotice resource={resource} />
      <DigitList title={label} subtitle={subtitle} filters={filterElements} hasCreate={canEditResource(resource)}>
        {schemaColumns ? (
          <DigitDatagrid columns={schemaColumns} rowClick="show" />
        ) : (
          <AutoDetectDatagrid descriptor={descriptor} />
        )}
      </DigitList>
    </>
  );
}

/** Fallback: auto-detect columns from the first record (original behavior) */
function AutoDetectDatagrid({ descriptor }: { descriptor?: SchemaDescriptor }) {
  const { data } = useListContext();
  const firstRecord = data?.[0];

  const columns: DigitColumn[] = useMemo(() => {
    if (!firstRecord) return [{ source: 'id', label: 'ID' }];
    const detected = Object.keys(firstRecord as Record<string, unknown>)
      .filter((key) => !key.startsWith('_') && key !== 'id')
      .slice(0, 8)
      .map((key) => ({
        source: key,
        label: key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase()),
      }));
    return applyDescriptorListWidgets(detected, descriptor);
  }, [firstRecord, descriptor]);

  return <DigitDatagrid columns={columns} rowClick="show" />;
}
