import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Employee, MdmsRecord } from '@/api/types';
import { MasterDialog } from './departments/MasterDialog';
import { EmployeeDialog } from './employees/EmployeeDialog';
import { TypeDialog } from './complaints/TypeDialog';
import type { EmployeeOptions } from './employees/employeesApi';

/** The control a label names, and whether that label carries the red asterisk. */
function field(label: RegExp) {
  const control = screen.getByLabelText(label);
  const tag = document.querySelector(`label[for="${control.id}"]`);
  return { control, marked: !!tag?.querySelector('[data-required-mark]') };
}

/** A checklist's fieldset, by its legend, and whether the legend carries the asterisk. */
function group(name: RegExp) {
  const fieldset = screen.getByRole('group', { name });
  return !!fieldset.querySelector('legend [data-required-mark]');
}

const record = (code: string, name: string): MdmsRecord => ({
  id: code,
  tenantId: 'acme',
  schemaCode: 'common-masters.Department',
  uniqueIdentifier: code,
  data: { code, name, active: true },
  isActive: true,
});

describe('department and designation', () => {
  const dialog = (props: Partial<Parameters<typeof MasterDialog>[0]> = {}) =>
    render(
      <MasterDialog
        kind="department"
        open
        departments={[]}
        takenCodes={new Set()}
        onOpenChange={vi.fn()}
        onSave={vi.fn()}
        {...props}
      />,
    );

  it('marks the name and the code when adding', () => {
    dialog();
    for (const label of [/^Department name/, /^Department code/]) {
      const { control, marked } = field(label);
      expect(marked).toBe(true);
      expect(control).toHaveAttribute('aria-required', 'true');
    }
  });

  it('leaves the locked code unmarked when editing', () => {
    dialog({ record: record('ROADS', 'Roads') });
    expect(field(/^Department name/).marked).toBe(true);
    const code = field(/^Department code/);
    expect(code.marked).toBe(false);
    expect(code.control).toHaveAttribute('aria-required', 'false');
  });

  it('leaves a designation’s optional departments unmarked', () => {
    dialog({ kind: 'designation', departments: [record('ROADS', 'Roads')] });
    expect(group(/^Departments/)).toBe(false);
  });
});

describe('employee', () => {
  const options: EmployeeOptions = {
    departments: [{ code: 'ROADS', name: 'Roads' }],
    designations: [{ code: 'ENGINEER', name: 'Engineer', departments: ['ROADS'] }],
    roles: [{ code: 'EMPLOYEE', name: 'Employee' }],
    boundaries: [{ code: 'W1', name: 'Ward 1', boundaryType: 'Ward', hierarchyType: 'ADMIN', depth: 1 }],
    mobilePattern: /^\d{9}$/,
  };
  const dialog = (props: Partial<Parameters<typeof EmployeeDialog>[0]> = {}) =>
    render(
      <EmployeeDialog
        open
        options={options}
        suggestedCode="EMP_0001"
        takenCodes={new Set()}
        onOpenChange={vi.fn()}
        onSave={vi.fn()}
        {...props}
      />,
    );

  it('marks everything it checks before saving, and not the optional roles', () => {
    dialog();
    for (const label of [/^Employee code/, /^Full name/, /^Mobile number/, /^Email/, /^Department/, /^Designation/]) {
      const { control, marked } = field(label);
      expect(marked, String(label)).toBe(true);
      expect(control, String(label)).toHaveAttribute('aria-required', 'true');
    }
    expect(group(/^Jurisdictions/)).toBe(true);
    expect(group(/^System roles/)).toBe(false);
  });

  it('says to add departments first when none can be picked', () => {
    dialog({ options: { ...options, departments: [] } });
    expect(screen.getByText('Add departments first.')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /^Department/ })).toBeNull();
  });

  it('drops the mark from what is read-only while editing', () => {
    const employee = {
      code: 'EMP_0001',
      tenantId: 'acme',
      user: { name: 'Anita Wanjiru', mobileNumber: '712345678', emailId: 'anita@example.org', roles: [] },
      assignments: [{ department: 'ROADS', designation: 'ENGINEER', isCurrentAssignment: true }],
      jurisdictions: [{ boundary: 'W1', boundaryType: 'Ward', hierarchy: 'ADMIN', isActive: true }],
    } as unknown as Employee;
    dialog({ employee, emailLocked: true });
    expect(field(/^Employee code/).marked).toBe(false);
    expect(field(/^Email/).marked).toBe(false);
    expect(field(/^Full name/).marked).toBe(true);
    expect(field(/^Department/).marked).toBe(true);
  });
});

describe('complaint category', () => {
  it('marks the name and who handles it, not the optional subcategories', () => {
    render(
      <TypeDialog
        open
        departments={[{ code: 'ROADS', name: 'Roads' }]}
        takenNames={[]}
        defaultHours={72}
        onOpenChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );
    for (const label of [/^Name/, /^Handled by/]) {
      const { control, marked } = field(label);
      expect(marked, String(label)).toBe(true);
      expect(control, String(label)).toHaveAttribute('aria-required', 'true');
    }
    expect(field(/^Subcategories/).marked).toBe(false);
    expect(field(/^Resolution time/).marked).toBe(false);
  });
});
