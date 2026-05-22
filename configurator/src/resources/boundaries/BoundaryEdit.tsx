import { DigitEdit, DigitFormInput, DigitFormSelect } from '@/admin';

const BOUNDARY_TYPE_CHOICES = [
  { value: 'City', label: 'City' },
  { value: 'Ward', label: 'Ward' },
  { value: 'Locality', label: 'Locality' },
  { value: 'Block', label: 'Block' },
  { value: 'District', label: 'District' },
  { value: 'State', label: 'State' },
];

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
    </DigitEdit>
  );
}
