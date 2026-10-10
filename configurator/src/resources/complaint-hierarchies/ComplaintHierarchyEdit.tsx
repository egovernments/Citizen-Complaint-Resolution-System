import { DigitEdit, DigitFormInput } from '@/admin';
import { FieldSection } from '@/admin/fields';
import { BooleanInput } from '@/admin/widgets';
import { ComplaintLevelEditor } from './ComplaintLevelEditor';
import { levelsForEdit } from './hierarchyLevels';

/** Edit a live complaint hierarchy: each level's label (what the citizen and employee pickers show when no
 *  <HIERARCHY>_<LEVEL> message is localized) and free-text flag, and the definition's Active flag.
 *  The structure (level codes, parents, leaf level, order) is locked: nodes and filed complaints point at it;
 *  restructuring is the Migrate action. */
export function ComplaintHierarchyEdit() {
  return (
    <DigitEdit
      title="Edit Complaint Hierarchy"
      redirect="show"
      transform={(data: Record<string, unknown>, opts?: { previousData?: Record<string, unknown> }) => ({
        ...data,
        levels: levelsForEdit(opts?.previousData?.levels ?? data.levels, data.levels),
      })}
    >
      <FieldSection title="Details">
        <div className="space-y-4">
          <DigitFormInput source="hierarchyType" label="Hierarchy Type" disabled />
          <BooleanInput source="active" label="Active" />
        </div>
      </FieldSection>
      <FieldSection title="Levels">
        <ComplaintLevelEditor locked help="Level codes, parents and the leaf level are fixed once complaints use them (restructure with Migrate)." />
      </FieldSection>
    </DigitEdit>
  );
}
