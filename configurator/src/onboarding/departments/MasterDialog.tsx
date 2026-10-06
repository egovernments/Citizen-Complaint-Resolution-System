import { useId, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { MdmsRecord } from '@/api/types';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { describeSaveError } from '../errors';
import { useOnboardingT } from '../i18n';
import { CODE_PATTERN, recordDepartments, recordName, suggestCode, type MasterInput, type MasterKind } from './mastersApi';

const EXAMPLE: Record<MasterKind, { code: string }> = {
  department: { code: 'ROADS_INFRASTRUCTURE' },
  designation: { code: 'WARD_OFFICER' },
};

/**
 * Add or edit one department or designation: the one dialog both use, opened
 * by "Add" and, pre-filled, by a row's Edit. A code is suggested from the name
 * until it is typed over, and cannot change once saved (it is the record's key).
 */
export function MasterDialog({
  kind,
  open,
  record,
  departments,
  takenCodes,
  onOpenChange,
  onSave,
}: {
  kind: MasterKind;
  open: boolean;
  /** Set when editing. */
  record?: MdmsRecord;
  /** Designations choose from these. */
  departments: MdmsRecord[];
  takenCodes: Set<string>;
  onOpenChange: (open: boolean) => void;
  onSave: (input: MasterInput) => Promise<void>;
}) {
  const id = useId();
  const t = useOnboardingT();
  // Department and designation wording differ, so each has its own key.
  const isDepartment = kind === 'department';
  const editing = !!record;

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [codeTouched, setCodeTouched] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [errors, setErrors] = useState<{ name?: string; code?: string }>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Each opening starts from the record being edited, or blank.
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const openKey = open ? record?.uniqueIdentifier ?? '(new)' : null;
  if (openKey !== openedFor) {
    setOpenedFor(openKey);
    if (openKey) {
      setName(record ? recordName(record) : '');
      setCode(record?.uniqueIdentifier ?? '');
      setCodeTouched(!!record);
      setPicked(record ? recordDepartments(record) : []);
      setErrors({});
      setSaveError(null);
    }
  }

  const save = async () => {
    const trimmed = name.trim();
    const next: { name?: string; code?: string } = {};
    if (!trimmed) {
      next.name = isDepartment
        ? t('departments.department_name_required', 'Enter the department’s name.')
        : t('departments.designation_name_required', 'Enter the designation’s name.');
    } else if (trimmed.length > 100) next.name = t('departments.name_too_long', 'Keep the name under %{max} characters.', { max: 100 });
    if (!editing) {
      if (!code) {
        next.code = isDepartment
          ? t('departments.department_code_required', 'Enter a department code.')
          : t('departments.designation_code_required', 'Enter a designation code.');
      } else if (!CODE_PATTERN.test(code)) next.code = t('departments.code_pattern', 'Use capital letters, digits and underscores only.');
      else if (takenCodes.has(code)) {
        next.code = isDepartment
          ? t('departments.department_code_taken', 'Another department already uses this code.')
          : t('departments.designation_code_taken', 'Another designation already uses this code.');
      }
    }
    setErrors(next);
    if (next.name || next.code) return;

    setSaving(true);
    setSaveError(null);
    try {
      await onSave({ code, name: trimmed, departments: kind === 'designation' ? picked : undefined });
      onOpenChange(false);
    } catch (err) {
      const fallback = isDepartment
        ? t('departments.department_save_failed', 'Saving the department failed. Try again.')
        : t('departments.designation_save_failed', 'Saving the designation failed. Try again.');
      setSaveError(describeSaveError(err, fallback, t));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {editing
              ? t('common.edit_named', 'Edit %{name}', { name: recordName(record!) })
              : isDepartment
                ? t('departments.department_add_title', 'Add a department')
                : t('departments.designation_add_title', 'Add a designation')}
          </DialogTitle>
          <DialogDescription>
            {isDepartment
              ? t('departments.department_dialog_intro', 'Complaints are routed to departments, and every employee belongs to one.')
              : t('departments.designation_dialog_intro', 'The role an employee holds, like Ward Officer or Engineer.')}
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="space-y-1.5">
            <label htmlFor={`${id}-name`} className="block text-sm font-medium text-foreground">
              {isDepartment ? t('departments.department_name_label', 'Department name') : t('departments.designation_name_label', 'Designation name')}
            </label>
            <Input
              id={`${id}-name`}
              value={name}
              autoFocus
              placeholder={
                isDepartment
                  ? t('departments.department_name_example', 'Roads and Infrastructure')
                  : t('departments.designation_name_example', 'Ward Officer')
              }
              onChange={(event) => {
                setName(event.target.value);
                // The code follows the name until someone types their own.
                if (!codeTouched) setCode(suggestCode(event.target.value));
              }}
              aria-invalid={!!errors.name}
            />
            {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
          </div>

          <div className="space-y-1.5">
            <label htmlFor={`${id}-code`} className="block text-sm font-medium text-foreground">
              {isDepartment ? t('departments.department_code_label', 'Department code') : t('departments.designation_code_label', 'Designation code')}
            </label>
            <Input
              id={`${id}-code`}
              value={code}
              disabled={editing}
              placeholder={EXAMPLE[kind].code}
              onChange={(event) => {
                setCodeTouched(true);
                setCode(event.target.value.toUpperCase().replace(/\s+/g, '_'));
              }}
              aria-invalid={!!errors.code}
              className="font-mono"
            />
            <p className={`text-xs ${errors.code ? 'text-destructive' : 'text-muted-foreground'}`}>
              {errors.code ??
                (editing
                  ? t('departments.code_locked', 'A code can’t change once it’s saved.')
                  : t('departments.code_suggested', 'Suggested from the name. You can change it.'))}
            </p>
          </div>

          {kind === 'designation' && departments.length > 0 && (
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium text-foreground">
                {t('departments.departments', 'Departments')}{' '}
                <span className="font-normal text-muted-foreground">{t('common.optional', '(optional)')}</span>
              </legend>
              <div className="max-h-40 overflow-y-auto rounded-md border border-border p-2 space-y-1">
                {departments.map((department) => {
                  const departmentCode = department.uniqueIdentifier;
                  const checked = picked.includes(departmentCode);
                  return (
                    <label key={departmentCode} className="flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setPicked((current) =>
                            checked ? current.filter((value) => value !== departmentCode) : [...current, departmentCode],
                          )
                        }
                        className="h-4 w-4 accent-[hsl(var(--primary))]"
                      />
                      <span className="flex-1">{recordName(department)}</span>
                      <span className="font-mono text-xs text-muted-foreground">{departmentCode}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}

          {saveError && (
            <Alert variant="destructive">
              <AlertDescription>{saveError}</AlertDescription>
            </Alert>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button type="submit" disabled={saving} className="gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              {editing
                ? t('common.save_changes', 'Save changes')
                : isDepartment
                  ? t('departments.department_add', 'Add department')
                  : t('departments.designation_add', 'Add designation')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
