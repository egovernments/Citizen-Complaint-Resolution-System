import { DigitCreate, DigitFormInput, DigitFormSelect, v } from '@/admin';
import { FieldSection } from '@/admin/fields';
import { HierarchyLevelEditor } from './HierarchyLevelEditor';
import { useApp } from '@/App';

/** Create a boundary hierarchy on a chosen tenant. Immutable after
 *  creation — the `boundary-hierarchy-definition` service exposes only
 *  `_search` and `_create`; `_update` / `_delete` both return 400. Surface
 *  a single-shot Create only; do not register Edit or Delete. */
export function BoundaryHierarchyCreate() {
  const { state } = useApp();
  return (
    <DigitCreate
      title="Create Boundary Hierarchy"
      record={{
        tenantId: state.tenant,
        boundaryHierarchy: [{ boundaryType: '', parentBoundaryType: null }],
      }}
    >
      <FieldSection title="Details">
        <DigitFormSelect
          source="tenantId"
          label="Tenant"
          reference="tenants"
          optionValue="code"
          optionText="code"
          validate={v.codeRequired}
          placeholder="Select tenant"
        />
        <DigitFormInput
          source="hierarchyType"
          label="Hierarchy Type"
          validate={v.codeRequired}
          help="Short uppercase identifier, e.g. ADMIN, REVENUE, ELECTION. One per tenant per type."
        />
      </FieldSection>

      <FieldSection title="Levels">
        <HierarchyLevelEditor
          help="First row is the root (no parent). Each subsequent row's parent must reference a boundaryType defined in an earlier row."
        />
      </FieldSection>
    </DigitCreate>
  );
}
