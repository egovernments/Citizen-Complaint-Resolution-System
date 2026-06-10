/**
 * Shared per-escalation-level SLA editor — a list of "L0 (first
 * assignment)" / "L1" / … rows with an hours input each, plus
 * add-level / remove-last controls. Designed to sit inside a Dialog body
 * (the matrix "Levels" cell) or inline in a settings card (the
 * Escalation Settings policy form); the host owns Save/Cancel.
 *
 * Two modes:
 *   - allowHoles (CategorySLA rows): a blank input is a hole (null) —
 *     "use the state cell at this level"
 *   - policy mode (allowHoles=false, EscalationPolicy level defaults):
 *     blanks are rejected, the saved array must be solid numbers
 *
 * The editor owns its draft after mount — remount with a fresh `key` to
 * reset it (e.g. on Revert), the same pattern AddRowDialog uses for its
 * field state. Every edit reports the parsed values + per-row errors via
 * onChange; hosts must treat the values as unsaveable while any error is
 * non-null. All parsing/validation lives in levelSlaValues.ts (pure,
 * unit-tested); this file is only the rendering shell.
 */
import { useState } from 'react';
import { Plus, Minus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  levelInputsToValues,
  levelLabel,
  levelValuesToInputs,
  validateLevelInputs,
  type LevelValues,
} from './levelSlaValues';

/** Hard cap on list length — mirrors the policy maxDepth range (1–10). */
const DEFAULT_MAX_LEVELS = 10;

export interface LevelSlaEditorProps {
  /** Values to seed the draft from; the editor owns the draft after mount. */
  initialValue?: LevelValues | null;
  /** Blank rows allowed (CategorySLA) vs rejected (policy mode). */
  allowHoles: boolean;
  /**
   * Fires on every edit with the parsed values and per-row errors
   * (null = row valid). Only save when every error is null.
   */
  onChange: (values: LevelValues, errors: (string | null)[]) => void;
  disabled?: boolean;
  /** Maximum number of levels the add button allows (default 10). */
  maxLevels?: number;
}

export function LevelSlaEditor({
  initialValue,
  allowHoles,
  onChange,
  disabled,
  maxLevels = DEFAULT_MAX_LEVELS,
}: LevelSlaEditorProps) {
  const [inputs, setInputs] = useState<string[]>(() => levelValuesToInputs(initialValue));
  const errors = validateLevelInputs(inputs, allowHoles);

  function emit(next: string[]) {
    setInputs(next);
    onChange(levelInputsToValues(next), validateLevelInputs(next, allowHoles));
  }

  function patchInput(index: number, raw: string) {
    emit(inputs.map((v, i) => (i === index ? raw : v)));
  }

  function addLevel() {
    if (inputs.length >= maxLevels) return;
    emit([...inputs, '']);
  }

  function removeLast() {
    if (inputs.length === 0) return;
    emit(inputs.slice(0, -1));
  }

  return (
    <div className="space-y-2">
      {inputs.length === 0 && (
        <p className="text-xs text-muted-foreground italic">No levels set.</p>
      )}
      {inputs.map((raw, i) => (
        <div key={i} className="space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground w-32 shrink-0">{levelLabel(i)}</span>
            <Input
              type="number"
              value={raw}
              onChange={(e) => patchInput(i, e.target.value)}
              className="h-7 w-24 text-xs"
              placeholder={allowHoles ? '—' : 'hours'}
              disabled={disabled}
              aria-label={`${levelLabel(i)} SLA hours`}
              aria-invalid={errors[i] !== null}
            />
            <span className="text-xs text-muted-foreground">hours</span>
          </div>
          {errors[i] && (
            <p className="text-xs text-destructive ml-[8.5rem]">{errors[i]}</p>
          )}
        </div>
      ))}
      <div className="flex items-center gap-2 pt-1">
        <Button
          size="sm"
          variant="outline"
          onClick={addLevel}
          disabled={disabled || inputs.length >= maxLevels}
        >
          <Plus className="w-3.5 h-3.5 mr-1" />
          Add level
        </Button>
        {inputs.length > 0 && (
          <Button size="sm" variant="ghost" onClick={removeLast} disabled={disabled}>
            <Minus className="w-3.5 h-3.5 mr-1" />
            Remove last
          </Button>
        )}
      </div>
      {allowHoles && inputs.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Blank levels use this row's state cells instead.
        </p>
      )}
    </div>
  );
}
