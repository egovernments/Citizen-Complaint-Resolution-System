import { DigitCreate, DigitFormInput, v } from '@/admin';
import { FieldSection } from '@/admin/fields';
import { ComplaintLevelEditor } from './ComplaintLevelEditor';
import { levelsForSave } from './hierarchyLevels';


/** Author a complaint classification hierarchy. The number of levels is fully
 *  configurable — this is the complaint-side analogue of the boundary
 *  HierarchyDefinition. Stored as a plain MDMS master
 *  (RAINMAKER-PGR.ComplaintHierarchyDefinition); the data-provider targets the
 *  session tenant, so do NOT put tenantId in the record (the schema is
 *  additionalProperties:false). The transform (levelsForSave) keeps each level's
 *  label / free-text / active and fills only what is empty; `order` is the row position. */
export function ComplaintHierarchyCreate() {
  return (
    <DigitCreate
      title="Create Complaint Hierarchy"
      record={{
        hierarchyType: '',
        active: true,
        levels: [{ levelCode: '', parentLevel: null, isLeafServiceCode: false }],
      }}
      transform={(data: Record<string, unknown>) => {
        const levels = levelsForSave(data.levels);
        return {
          hierarchyType: data.hierarchyType,
          active: true,
          levels,
        };
      }}
    >
      <FieldSection title="Details">
        <DigitFormInput
          source="hierarchyType"
          label="Hierarchy Type"
          validate={v.codeRequired}
          help="Short uppercase identifier, e.g. PGR. One per tenant. Created on your current tenant."
        />
      </FieldSection>

      <FieldSection title="Levels">
        <ComplaintLevelEditor
          help="Top → leaf order. Row 1 is the root (e.g. AUTHORITY_TYPE). Add as many levels as you need — the count is the depth. Mark exactly one level as the leaf (its values are complaint serviceCodes)."
        />
      </FieldSection>
    </DigitCreate>
  );
}
