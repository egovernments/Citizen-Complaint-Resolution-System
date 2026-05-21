import { DigitShow } from './DigitShow';
import { FieldSection, FieldRow, StatusChip, JsonViewer } from './fields';
import { EntityLink } from '@/components/ui/EntityLink';
import { ReverseReferenceList } from './fields/ReverseReferenceList';
import { useShowController, useResourceContext } from 'ra-core';
import { getResourceConfig, getResourceLabel, getResourceBySchema } from '@/providers/bridge';
import { useSchemaDefinition } from '@/hooks/useSchemaDefinition';
import { useReverseRefs } from '@/hooks/useReverseRefs';
import { groupShowFields, getRefMap, formatFieldLabel } from './schemaUtils';
import type { SchemaDefinition, RefMapEntry } from './schemaUtils';
import type { ReverseRef } from '@/hooks/useReverseRefs';

export function MdmsResourceShow() {
  const resource = useResourceContext() ?? '';
  const config = getResourceConfig(resource);
  const label = getResourceLabel(resource);
  const { record } = useShowController();

  // Fetch schema definition and reverse refs
  const { definition } = useSchemaDefinition(config?.schema);
  const { refs: reverseRefs } = useReverseRefs(config?.schema);

  return (
    <DigitShow title={record ? `${label}: ${record[config?.idField ?? 'id'] ?? record.id}` : label} hasEdit>
      {(rec: Record<string, unknown>) => {
        if (definition) {
          return <SchemaShowContent rec={rec} definition={definition} reverseRefs={reverseRefs} />;
        }
        return <FallbackShowContent rec={rec} />;
      }}
    </DigitShow>
  );
}

/** Schema-driven Show content with grouped fields, EntityLinks, and reverse refs */
function SchemaShowContent({
  rec,
  definition,
  reverseRefs,
}: {
  rec: Record<string, unknown>;
  definition: SchemaDefinition;
  reverseRefs: ReverseRef[];
}) {
  const refMap = getRefMap(definition, getResourceBySchema);
  const groups = groupShowFields(definition);

  // Find extra fields in data that aren't in the schema
  const schemaFields = new Set(Object.keys(definition.properties ?? {}));
  const extraFields = Object.keys(rec).filter(
    (k) => !k.startsWith('_') && k !== 'id' && !schemaFields.has(k)
  );

  return (
    <div className="space-y-6">
      {/* Key fields (x-unique) */}
      {groups.key.length > 0 && (
        <FieldSection title="Key">
          {groups.key.map((field) => (
            <SchemaFieldRow key={field} field={field} value={rec[field]} refMap={refMap} definition={definition} />
          ))}
        </FieldSection>
      )}

      {/* Required fields */}
      {groups.details.length > 0 && (
        <FieldSection title="Details">
          {groups.details.map((field) => (
            <SchemaFieldRow key={field} field={field} value={rec[field]} refMap={refMap} definition={definition} />
          ))}
        </FieldSection>
      )}

      {/* Optional fields */}
      {groups.optional.length > 0 && (
        <FieldSection title="Additional">
          {groups.optional.map((field) => (
            <SchemaFieldRow key={field} field={field} value={rec[field]} refMap={refMap} definition={definition} />
          ))}
        </FieldSection>
      )}

      {/* Complex fields (arrays, objects) */}
      {groups.complex.length > 0 && (
        <FieldSection title="Nested Data">
          {groups.complex.map((field) => (
            <FieldRow key={field} label={formatFieldLabel(field)}>
              {rec[field] != null ? (
                <JsonViewer data={rec[field]} initialExpanded={false} />
              ) : (
                <span className="text-muted-foreground">--</span>
              )}
            </FieldRow>
          ))}
        </FieldSection>
      )}

      {/* Extra fields not in schema */}
      {extraFields.length > 0 && (
        <FieldSection title="Extra Fields">
          {extraFields.map((field) => {
            const value = rec[field];
            if (value != null && typeof value === 'object') {
              return (
                <FieldRow key={field} label={formatFieldLabel(field)}>
                  <JsonViewer data={value} initialExpanded={false} />
                </FieldRow>
              );
            }
            return (
              <FieldRow key={field} label={formatFieldLabel(field)}>
                {value != null ? String(value) : '--'}
              </FieldRow>
            );
          })}
        </FieldSection>
      )}

      {/* Reverse References */}
      {reverseRefs.filter((ref) => ref.fromResource).length > 0 && (
        <FieldSection title="Referenced By">
          {reverseRefs
            .filter((ref) => ref.fromResource)
            .map((ref) => {
              // The fieldPath tells us which field in the REFERENCING schema points to us.
              // We need the value from OUR record that they reference.
              // Usually it's the first x-unique field.
              const unique = definition['x-unique'];
              const targetField = unique && unique.length > 0 ? unique[0] : 'id';
              const targetValue = String(rec[targetField] ?? rec.id ?? '');
              return (
                <ReverseReferenceList
                  key={`${ref.fromSchema}-${ref.fieldPath}`}
                  resource={ref.fromResource}
                  target={ref.fieldPath}
                  id={targetValue}
                  label={ref.fromLabel}
                  limit={5}
                />
              );
            })}
        </FieldSection>
      )}

      {/* Schema Definition (collapsible, default collapsed) */}
      <FieldSection title="Schema Definition">
        <JsonViewer data={definition} initialExpanded={false} />
      </FieldSection>
    </div>
  );
}

/** Render a single field with type-aware formatting and EntityLink for refs */
function SchemaFieldRow({
  field,
  value,
  refMap,
  definition,
}: {
  field: string;
  value: unknown;
  refMap: Record<string, RefMapEntry>;
  definition: SchemaDefinition;
}) {
  const label = formatFieldLabel(field);
  const ref = refMap[field];
  const propType = definition.properties?.[field]?.type;

  // EntityLink for referenced fields
  if (ref && value != null && value !== '') {
    return (
      <FieldRow label={label}>
        <EntityLink resource={ref.resource} id={String(value)} />
      </FieldRow>
    );
  }

  // Boolean → StatusChip
  if (propType === 'boolean' || typeof value === 'boolean') {
    return (
      <FieldRow label={label}>
        <StatusChip value={value} labels={{ true: 'Yes', false: 'No' }} />
      </FieldRow>
    );
  }

  // Default: plain text
  return (
    <FieldRow label={label}>
      {value != null ? String(value) : <span className="text-muted-foreground">--</span>}
    </FieldRow>
  );
}

/** Fallback: original generic rendering (no schema available) */
function FallbackShowContent({ rec }: { rec: Record<string, unknown> }) {
  const keys = Object.keys(rec).filter((k) => !k.startsWith('_') && k !== 'id');

  return (
    <div className="space-y-6">
      <FieldSection title="Details">
        {keys.map((key) => {
          const value = rec[key];
          const displayKey = key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());

          if (typeof value === 'boolean') {
            return (
              <FieldRow key={key} label={displayKey}>
                <StatusChip value={value} labels={{ true: 'Yes', false: 'No' }} />
              </FieldRow>
            );
          }

          if (value != null && typeof value === 'object') {
            return (
              <FieldRow key={key} label={displayKey}>
                <JsonViewer data={value} initialExpanded={false} />
              </FieldRow>
            );
          }

          return (
            <FieldRow key={key} label={displayKey}>
              {value != null ? String(value) : '--'}
            </FieldRow>
          );
        })}
      </FieldSection>
    </div>
  );
}
