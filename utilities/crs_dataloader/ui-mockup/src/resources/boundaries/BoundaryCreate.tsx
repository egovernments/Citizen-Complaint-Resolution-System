import { DigitCreate, DigitFormCodeInput, DigitFormSelect, v } from '@/admin';

const BOUNDARY_TYPE_CHOICES = [
  { value: 'City', label: 'City' },
  { value: 'Ward', label: 'Ward' },
  { value: 'Locality', label: 'Locality' },
  { value: 'Block', label: 'Block' },
  { value: 'District', label: 'District' },
  { value: 'State', label: 'State' },
];

export function BoundaryCreate() {
  return (
    <DigitCreate title="Create Boundary">
      <DigitFormCodeInput source="code" label="Code" validate={v.codeRequired} />
      <DigitFormSelect
        source="boundaryType"
        label="Boundary Type"
        choices={BOUNDARY_TYPE_CHOICES}
        placeholder="Select type..."
      />
    </DigitCreate>
  );
}
