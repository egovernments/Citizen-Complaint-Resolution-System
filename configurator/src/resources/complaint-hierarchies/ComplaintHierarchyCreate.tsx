import { DigitCreate, DigitFormInput, v } from '@/admin';
import { FieldSection } from '@/admin/fields';
import { ComplaintLevelEditor } from './ComplaintLevelEditor';

interface EditorLevel {
  levelCode?: string;
  parentLevel?: string | null;
  isLeafServiceCode?: boolean;
}

/** Author a complaint classification hierarchy. The number of levels is fully
 *  configurable — this is the complaint-side analogue of the boundary
 *  HierarchyDefinition. Stored as a plain MDMS master
 *  (RAINMAKER-PGR.ComplaintHierarchyDefinition); the data-provider targets the
 *  session tenant, so do NOT put tenantId in the record (the schema is
 *  additionalProperties:false). The transform stamps `order` from row position
 *  and fills the optional fields the schema accepts. */
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
        const levels = (Array.isArray(data.levels) ? (data.levels as EditorLevel[]) : [])
          .filter((l) => l && l.levelCode)
          .map((l, i) => ({
            levelCode: l.levelCode as string,
            order: i + 1,
            parentLevel: i === 0 ? null : l.parentLevel || null,
            isFreeText: false,
            isLeafServiceCode: !!l.isLeafServiceCode,
            label: (l.levelCode as string),
          }));
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
