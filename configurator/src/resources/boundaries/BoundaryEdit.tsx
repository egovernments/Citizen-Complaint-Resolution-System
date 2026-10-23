import { useGetList, useRecordContext } from 'ra-core';
import { DigitEdit, DigitFormInput, DigitFormSelect } from '@/admin';
import { JsonInput } from '@/admin/widgets';
import { parentChoices, placementOf } from './boundaryPlacement';

const BOUNDARY_TYPE_CHOICES = [
  { value: 'City', label: 'City' },
  { value: 'Ward', label: 'Ward' },
  { value: 'Locality', label: 'Locality' },
  { value: 'Block', label: 'Block' },
  { value: 'District', label: 'District' },
  { value: 'State', label: 'State' },
];

/** Where the boundary sits: its parent can be moved to another boundary of the parent's level, same hierarchy. */
function ParentField() {
  const record = useRecordContext();
  const { data: rows = [] } = useGetList('boundaries', {
    pagination: { page: 1, perPage: 10000 },
    sort: { field: 'code', order: 'ASC' },
    filter: {},
  });
  const placement = placementOf(rows, record?.id);
  if (!placement) return null;
  if (!placement.parent) {
    return <p className="text-xs text-muted-foreground">Top level of hierarchy {placement.hierarchyType}: it has no parent to change.</p>;
  }
  return (
    <DigitFormSelect
      source="parent"
      label={`Parent (${placement.parentType})`}
      choices={parentChoices(rows, placement)}
      defaultValue={placement.parent}
      help={`Move this ${placement.boundaryType} under another ${placement.parentType} of hierarchy ${placement.hierarchyType}. Its children move with it.`}
    />
  );
}

export function BoundaryEdit() {
  return (
    <DigitEdit title="Edit Boundary">
      <DigitFormInput source="code" label="Code" disabled />
      <DigitFormSelect
        source="boundaryType"
        label="Boundary Type"
        choices={BOUNDARY_TYPE_CHOICES}
        placeholder="Select type..."
        disabled
      />
      <ParentField />
      <JsonInput
        source="additionalDetails"
        label="Additional details"
        help="Free-form attributes of the boundary (JSON object), e.g. its latitude / longitude."
      />
      <JsonInput
        source="geometry"
        label="Geometry"
        help='GeoJSON geometry of the boundary (e.g. {"type": "Point", "coordinates": [lng, lat]} or a Polygon).'
      />
    </DigitEdit>
  );
}
