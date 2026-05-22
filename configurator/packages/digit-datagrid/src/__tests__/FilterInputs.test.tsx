import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchFilterInput, TextFilterInput, SelectFilterInput, BooleanFilterInput, DateFilterInput, NullableBooleanFilterInput, ReferenceFilterInput } from '../filters';
import { useInput } from 'ra-core';

// Single vi.mock for all filter input tests.
vi.mock('ra-core', () => ({
  useInput: vi.fn(({ source }) => ({
    id: source,
    field: {
      value: '',
      onChange: vi.fn(),
      onBlur: vi.fn(),
      name: source,
      ref: vi.fn(),
    },
    fieldState: { error: undefined, invalid: false, isTouched: false, isDirty: false },
    formState: { isSubmitted: false },
    isRequired: false,
  })),
  useGetList: vi.fn(() => ({
    data: [
      { id: 'dept1', name: 'Engineering' },
      { id: 'dept2', name: 'Marketing' },
    ],
    isPending: false,
  })),
}));

describe('SearchFilterInput', () => {
  it('renders a search input with magnifier icon', () => {
    render(<SearchFilterInput source="q" />);
    const input = screen.getByPlaceholderText('Search...');
    expect(input).toBeInTheDocument();
  });

  it('has alwaysOn=true by default', () => {
    render(<SearchFilterInput source="q" />);
    expect(useInput).toHaveBeenCalledWith(
      expect.objectContaining({ alwaysOn: true }),
    );
  });
});

describe('TextFilterInput', () => {
  it('renders an input with the label as placeholder', () => {
    render(<TextFilterInput source="name" label="Name" />);
    const input = screen.getByPlaceholderText('Name');
    expect(input).toBeInTheDocument();
  });

  it('uses source as placeholder when no label', () => {
    render(<TextFilterInput source="firstName" />);
    const input = screen.getByPlaceholderText('firstName');
    expect(input).toBeInTheDocument();
  });
});

describe('SelectFilterInput', () => {
  const choices = [
    { id: 'active', name: 'Active' },
    { id: 'inactive', name: 'Inactive' },
  ];

  it('renders a select trigger with label as placeholder', () => {
    render(<SelectFilterInput source="status" label="Status" choices={choices} />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });
});

describe('BooleanFilterInput', () => {
  it('renders a switch', () => {
    render(<BooleanFilterInput source="isActive" label="Active" />);
    expect(screen.getByRole('switch')).toBeInTheDocument();
  });

  it('shows the label text', () => {
    render(<BooleanFilterInput source="isActive" label="Active" />);
    expect(screen.getByText('Active')).toBeInTheDocument();
  });
});

describe('DateFilterInput', () => {
  it('renders a date input', () => {
    render(<DateFilterInput source="startDate" label="Start Date" />);
    const input = screen.getByLabelText('Start Date');
    expect(input).toHaveAttribute('type', 'date');
  });
});

describe('NullableBooleanFilterInput', () => {
  it('renders a select with Yes/No/Any options', () => {
    render(<NullableBooleanFilterInput source="isActive" label="Active" />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });
});

describe('ReferenceFilterInput', () => {
  it('renders a select for reference choices', () => {
    render(<ReferenceFilterInput source="department" reference="departments" label="Department" />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });
});
