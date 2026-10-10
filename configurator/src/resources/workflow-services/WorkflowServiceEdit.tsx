import { useEditContext } from 'ra-core';
import { DigitEdit } from '@/admin';
import { FieldSection } from '@/admin/fields';
import { ChipArrayInput } from '@/admin/widgets/ChipArrayInput';

type Action = { action?: string; nextState?: string; roles?: string[] };
type State = { uuid?: string; state?: string | null; applicationStatus?: string | null; actions?: Action[] | null };

/** Roles per action: who may take each transition (Take Action menus, the backend's transition check). */
function RolesPerAction() {
  const { record } = useEditContext();
  const states = (record?.states as State[] | undefined) ?? [];
  const nameOf = (uuid?: string) => states.find((s) => s.uuid === uuid)?.state ?? uuid ?? '';
  return (
    <div className="space-y-6">
      {states.map((st, i) => (st.actions?.length ? (
        <FieldSection key={st.uuid ?? i} title={st.state || '(start)'}>
          <div className="space-y-4">
            {st.actions.map((ac, j) => (
              <ChipArrayInput
                key={`${ac.action}-${j}`}
                source={`states.${i}.actions.${j}.roles`}
                label={`${ac.action} → ${nameOf(ac.nextState)}`}
                help="Role codes allowed to take this action. Press Enter after each."
              />
            ))}
          </div>
        </FieldSection>
      ) : null))}
    </div>
  );
}

/**
 * Edit a workflow's roles per action. States, actions and next states are not editable here: a different
 * state machine is a new business service.
 */
export function WorkflowServiceEdit() {
  return (
    <DigitEdit title="Edit Workflow Roles" redirect="show">
      <RolesPerAction />
    </DigitEdit>
  );
}
