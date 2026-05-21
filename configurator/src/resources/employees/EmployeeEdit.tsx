import { useMemo, useState } from 'react';
import { useWatch, useFormContext } from 'react-hook-form';
import { useGetList, useInput, type InputProps } from 'ra-core';
import { Copy, KeyRound } from 'lucide-react';
import { DigitEdit, DigitFormInput, DigitFormSelect, v } from '@/admin';
import { FieldSection } from '@/admin/fields';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { DEFAULT_PASSWORD } from '@/api/config';
import { useMobileValidator } from '@/admin/hrms/useMobileValidator';
import { useApp } from '../../App';
import { RolesEditor } from './RolesEditor';
import { JurisdictionEditor } from './JurisdictionEditor';
import { AssignmentEditor } from './AssignmentEditor';

const GENDER_CHOICES = [
  { value: 'MALE', label: 'Male' },
  { value: 'FEMALE', label: 'Female' },
  { value: 'TRANSGENDER', label: 'Transgender' },
];

const STATUS_CHOICES = [
  { value: 'EMPLOYED', label: 'Employed' },
  { value: 'INACTIVE', label: 'Inactive' },
  { value: 'RETIRED', label: 'Retired' },
];

const TYPE_CHOICES = [
  { value: 'PERMANENT', label: 'Permanent' },
  { value: 'TEMPORARY', label: 'Temporary' },
  { value: 'CONTRACT', label: 'Contract' },
  { value: 'DEPUTATION', label: 'Deputation' },
];

function toEpochMs(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value) {
    const ms = new Date(value).getTime();
    return Number.isNaN(ms) ? undefined : ms;
  }
  return undefined;
}

function epochToDateInput(value: unknown): string {
  const ms = toEpochMs(value);
  if (ms === undefined) return '';
  try {
    return new Date(ms).toISOString().slice(0, 10);
  } catch {
    return '';
  }
}

interface DateEpochFieldProps extends InputProps {
  label?: string;
  help?: string;
  className?: string;
}

function DateEpochField({ label, help, className, ...inputProps }: DateEpochFieldProps) {
  const { id, field, fieldState, isRequired } = useInput(inputProps);
  const asString = epochToDateInput(field.value);
  const hasError = fieldState.invalid && fieldState.isTouched;
  const errorMessage = fieldState.error?.message;
  return (
    <div className={className}>
      {label && (
        <Label htmlFor={id} className="mb-1.5 block text-sm font-medium text-foreground">
          {label}
          {isRequired && <span className="text-destructive ml-0.5" aria-label="required">*</span>}
        </Label>
      )}
      <Input
        id={id}
        type="date"
        value={asString}
        onChange={(e) => {
          const ms = toEpochMs(e.target.value);
          field.onChange(ms ?? '');
        }}
        onBlur={field.onBlur}
        aria-invalid={hasError || undefined}
        className={hasError ? 'border-destructive focus-visible:ring-destructive' : ''}
      />
      {hasError && errorMessage && (
        <p className="mt-1 text-xs text-destructive" role="alert">{errorMessage}</p>
      )}
      {!hasError && help && (
        <p className="mt-1 text-xs text-muted-foreground">{help}</p>
      )}
    </div>
  );
}

function PasswordResetSection() {
  const pwd = useWatch({ name: 'user.password' }) as string | undefined;
  const { setValue } = useFormContext();
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const handleCopy = async () => {
    if (!pwd) return;
    try {
      await navigator.clipboard.writeText(pwd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const keepExisting = () => {
    setValue('user.password', '', { shouldDirty: true });
    setRevealed(false);
  };

  return (
    <div className="space-y-3">
      {!revealed ? (
        <div className="flex items-center gap-3">
          <Button type="button" variant="outline" size="sm" onClick={() => setRevealed(true)} className="gap-2">
            <KeyRound className="w-4 h-4" />
            Reset password
          </Button>
          <p className="text-xs text-muted-foreground">
            Leave closed to keep the existing password.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <DigitFormInput
            source="user.password"
            label="New password"
            placeholder={DEFAULT_PASSWORD}
            help="Employee must rotate on next login."
          />
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={handleCopy} disabled={!pwd} className="gap-1.5">
              <Copy className="w-3.5 h-3.5" />
              {copied ? 'Copied' : 'Copy'}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={keepExisting}>
              Keep existing
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function DeactivationReasonSection({ choices }: { choices: { value: string; label: string }[] }) {
  const status = useWatch({ name: 'employeeStatus' }) as string | undefined;
  if (status !== 'INACTIVE' && status !== 'RETIRED') return null;
  return (
    <FieldSection title="Deactivation">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <DigitFormSelect
          source="__deactivationReason"
          label="Reason for deactivation"
          choices={choices}
          placeholder="Select a reason..."
        />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        On save, the employee's <code>isActive</code> flag is flipped off and the reason is appended to their
        deactivation history.
      </p>
    </FieldSection>
  );
}

export function EmployeeEdit() {
  const { state } = useApp();
  const tenantId = state.tenant;
  const { validator: mobileValidate, rules: mobileRules } = useMobileValidator();

  const { data: reasonsList } = useGetList('deactivation-reasons', {
    pagination: { page: 1, perPage: 100 },
    sort: { field: 'code', order: 'ASC' },
  });
  const reasonChoices = useMemo(() => {
    // HRMS validates the submitted reason against MDMS `egov-hrms.DeactivationReason`
    // and rejects anything else with ERR_HRMS_INVALID_DEACT_REASON, so we cannot
    // surface UI-only defaults the server doesn't know about. If MDMS is empty,
    // fall back to OTHERS — egov-hrms ships it as a built-in code.
    const mdmsChoices = (reasonsList ?? []).map((r) => {
      const code = String((r as Record<string, unknown>).code ?? r.id);
      return { value: code, label: code };
    });
    if (mdmsChoices.length === 0) {
      return [{ value: 'OTHERS', label: 'Others' }];
    }
    return mdmsChoices;
  }, [reasonsList]);

  const transform = (data: Record<string, unknown>): Record<string, unknown> => {
    const user = { ...((data.user as Record<string, unknown> | undefined) ?? {}) };
    if (typeof user.password === 'string' && user.password === '') {
      delete user.password;
    }

    const status = typeof data.employeeStatus === 'string' ? data.employeeStatus : '';
    const isInactive = status === 'INACTIVE' || status === 'RETIRED';
    const reasonCode = typeof data.__deactivationReason === 'string' ? data.__deactivationReason : 'OTHERS';
    const existingDetails = Array.isArray(data.deactivationDetails) ? data.deactivationDetails : [];
    const deactivationDetails = isInactive
      ? [...existingDetails, { reasonForDeactivation: reasonCode, effectiveFrom: Date.now() }]
      : existingDetails;

    const { __deactivationReason: _dropped, ...rest } = data;
    void _dropped;

    return {
      ...rest,
      tenantId,
      user,
      isActive: !isInactive,
      deactivationDetails,
    };
  };

  return (
    <DigitEdit title="Edit Employee" transform={transform}>
      <FieldSection title="Employee Info">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <DigitFormInput source="code" label="Employee Code" disabled />
          <DigitFormInput source="user.name" label="Name" validate={v.name} />
          <DigitFormInput
            source="user.mobileNumber"
            label="Mobile Number"
            validate={mobileValidate}
            help={mobileRules.errorMessage}
          />
          <DigitFormInput source="user.emailId" label="Email" type="email" validate={v.emailOptional} />
          <DigitFormSelect
            source="user.gender"
            label="Gender"
            choices={GENDER_CHOICES}
            placeholder="Select gender..."
          />
          <DateEpochField source="user.dob" label="Date of Birth" />
          <DateEpochField source="dateOfAppointment" label="Date of Appointment" />
          <DigitFormSelect
            source="employeeType"
            label="Type"
            choices={TYPE_CHOICES}
            placeholder="Select type..."
          />
          <DigitFormSelect
            source="employeeStatus"
            label="Status"
            choices={STATUS_CHOICES}
            placeholder="Select status..."
          />
        </div>
      </FieldSection>

      <DeactivationReasonSection choices={reasonChoices} />

      <FieldSection title="Roles">
        <RolesEditor tenantId={tenantId} />
      </FieldSection>

      <FieldSection title="Assignments">
        <AssignmentEditor />
      </FieldSection>

      <FieldSection title="Jurisdictions">
        <JurisdictionEditor tenantId={tenantId} />
      </FieldSection>

      <FieldSection title="Account Password">
        <PasswordResetSection />
      </FieldSection>
    </DigitEdit>
  );
}
