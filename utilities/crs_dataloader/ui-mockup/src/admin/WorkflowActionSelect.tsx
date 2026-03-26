import { useMemo } from 'react';
import { useInput, useGetOne, type InputProps } from 'ra-core';
import { useWatch, useFormContext } from 'react-hook-form';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { DigitFormSelect } from './DigitFormSelect';

interface WorkflowState {
  state: string | null;
  applicationStatus: string | null;
  isStartState?: boolean;
  isTerminateState?: boolean;
  actions?: WorkflowAction[];
}

interface WorkflowAction {
  action: string;
  nextState: string;
  roles: string[];
}

export interface WorkflowActionSelectProps extends InputProps {
  /** The workflow business service code (e.g. 'PGR') */
  businessService: string;
  /** The form field that holds the current application status */
  statusSource?: string;
  /** Additional CSS class names */
  className?: string;
}

/** Human-readable labels for PGR workflow actions */
const ACTION_LABELS: Record<string, string> = {
  APPLY: 'Submit',
  ASSIGN: 'Assign to Employee',
  REASSIGN: 'Reassign to Employee',
  RESOLVE: 'Resolve',
  REJECT: 'Reject',
  REOPEN: 'Reopen',
  RATE: 'Rate & Close',
};

/** Human-readable labels for PGR states */
const STATE_LABELS: Record<string, string> = {
  PENDINGFORASSIGNMENT: 'Pending Assignment',
  PENDINGFORREASSIGNMENT: 'Pending Reassignment',
  PENDINGATLME: 'Pending at LME',
  RESOLVED: 'Resolved',
  REJECTED: 'Rejected',
  CLOSEDAFTERRESOLUTION: 'Closed (Resolved)',
  CLOSEDAFTERREJECTION: 'Closed (Rejected)',
};

/** Actions that require selecting an assignee */
const ASSIGNEE_ACTIONS = new Set(['ASSIGN', 'REASSIGN']);

/** Actions that require a rating */
const RATING_ACTIONS = new Set(['RATE']);

const RATING_CHOICES = [
  { value: '1', label: '1 — Poor' },
  { value: '2', label: '2 — Below Average' },
  { value: '3', label: '3 — Average' },
  { value: '4', label: '4 — Good' },
  { value: '5', label: '5 — Excellent' },
];

export function WorkflowActionSelect({
  businessService,
  statusSource = 'applicationStatus',
  className,
  ...inputProps
}: WorkflowActionSelectProps) {
  const {
    id,
    field,
    fieldState,
  } = useInput(inputProps);

  const { setValue } = useFormContext();

  // Watch the current application status in the form
  const currentStatus = useWatch({ name: statusSource }) as string | undefined;

  // Fetch the workflow business service definition
  const { data: workflowDef, isLoading } = useGetOne(
    'workflow-business-services',
    { id: businessService },
    { enabled: !!businessService },
  );

  // Find current state and extract available actions
  const { currentState, availableActions, isTerminal } = useMemo(() => {
    if (!workflowDef || !currentStatus) {
      return { currentState: null, availableActions: [], isTerminal: false };
    }

    const states = (workflowDef.states as WorkflowState[]) ?? [];
    const state = states.find((s) => s.applicationStatus === currentStatus);

    if (!state) {
      return { currentState: null, availableActions: [], isTerminal: false };
    }

    const actions = (state.actions ?? []).map((a) => ({
      value: a.action,
      label: ACTION_LABELS[a.action] ?? a.action,
      nextState: a.nextState,
      nextStateLabel: STATE_LABELS[a.nextState] ?? a.nextState,
      roles: a.roles,
    }));

    return {
      currentState: state,
      availableActions: actions,
      isTerminal: !!state.isTerminateState,
    };
  }, [workflowDef, currentStatus]);

  const selectedAction = field.value as string | undefined;
  const needsAssignee = selectedAction ? ASSIGNEE_ACTIONS.has(selectedAction) : false;
  const needsRating = selectedAction ? RATING_ACTIONS.has(selectedAction) : false;

  const hasError = fieldState.invalid && fieldState.isTouched;
  const errorMessage = fieldState.error?.message;

  // Clear assignee/rating when action changes
  const handleActionChange = (value: string) => {
    field.onChange(value);
    if (!ASSIGNEE_ACTIONS.has(value)) {
      setValue('assignee', undefined);
    }
    if (!RATING_ACTIONS.has(value)) {
      setValue('rating', undefined);
    }
  };

  return (
    <div className={className}>
      {/* Current status display */}
      <div className="mb-4">
        <Label className="mb-1.5 block text-sm font-medium text-foreground">
          Current Status
        </Label>
        <div className="flex items-center gap-2">
          <Badge
            variant={isTerminal ? 'secondary' : 'default'}
            className="text-sm"
          >
            {STATE_LABELS[currentStatus ?? ''] ?? currentStatus ?? 'Unknown'}
          </Badge>
          {isTerminal && (
            <span className="text-xs text-muted-foreground">(Terminal — no further actions)</span>
          )}
        </div>
      </div>

      {/* Action picker */}
      {!isTerminal && availableActions.length > 0 && (
        <div className="space-y-4">
          <div>
            <Label htmlFor={id} className="mb-1.5 block text-sm font-medium text-foreground">
              Workflow Action
            </Label>
            <Select
              value={field.value ?? ''}
              onValueChange={handleActionChange}
              disabled={isLoading}
            >
              <SelectTrigger
                id={id}
                aria-invalid={hasError || undefined}
                aria-describedby={hasError ? `${id}-error` : undefined}
                className={hasError ? 'border-destructive focus-visible:ring-destructive' : ''}
              >
                <SelectValue placeholder={isLoading ? 'Loading workflow...' : 'Select action...'} />
              </SelectTrigger>
              <SelectContent>
                {availableActions.map((action) => (
                  <SelectItem key={action.value} value={action.value}>
                    <span className="font-medium">{action.label}</span>
                    <span className="text-muted-foreground ml-1.5 text-xs">
                      {"→ "}{action.nextStateLabel}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Show roles hint for selected action */}
            {selectedAction && (() => {
              const selected = availableActions.find((a) => a.value === selectedAction);
              return selected ? (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Allowed roles: {selected.roles.join(', ')}
                </p>
              ) : null;
            })()}

            {hasError && errorMessage && (
              <p
                id={`${id}-error`}
                className="mt-1 text-xs text-destructive"
                role="alert"
              >
                {errorMessage}
              </p>
            )}
          </div>

          {/* Assignee picker — shown for ASSIGN/REASSIGN actions */}
          {needsAssignee && (
            <DigitFormSelect
              source="assignee"
              label="Assign to Employee"
              reference="employees"
              optionValue="uuid"
              optionText="user.name"
              placeholder="Select employee..."
            />
          )}

          {/* Rating picker — shown for RATE action */}
          {needsRating && (
            <DigitFormSelect
              source="rating"
              label="Rating"
              choices={RATING_CHOICES}
              placeholder="Select rating..."
            />
          )}
        </div>
      )}

      {!isTerminal && availableActions.length === 0 && !isLoading && currentState && (
        <p className="text-xs text-muted-foreground">No actions available from this state.</p>
      )}
    </div>
  );
}
