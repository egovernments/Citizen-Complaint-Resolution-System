import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CoreAdminContext, Form, TestMemoryRouter, type DataProvider } from 'ra-core';
import { QueryClient } from '@tanstack/react-query';
import { RegexInput } from './RegexInput';
import { regexCompiles } from './regexCompiles';

function renderRule(record: Record<string, unknown>, onSubmit: (values: unknown) => void) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <TestMemoryRouter>
      <CoreAdminContext dataProvider={{} as DataProvider} queryClient={queryClient}>
        <Form record={record} onSubmit={onSubmit}>
          <RegexInput source="regex" label="Regex pattern" />
          <button type="submit">Save</button>
        </Form>
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
}

const submitted = (onSubmit: ReturnType<typeof vi.fn>, call: number) => onSubmit.mock.calls[call][0] as Record<string, unknown>;

// #2787: the postal-code rule is edited here, and a pattern that doesn't compile is skipped by every form
// that reads it, so it must not be saved.
describe('RegexInput', () => {
  it('refuses to save a pattern that does not compile, and saves it once fixed', async () => {
    const onSubmit = vi.fn();
    renderRule({ fieldType: 'postalCode', regex: '^[0-9]{5}$' }, onSubmit);
    const input = screen.getByLabelText('Regex pattern');

    fireEvent.change(input, { target: { value: '^[0-9{4}$' } });
    expect(screen.getByText(/^Regex error:/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    // Validation is async: give the refused submit time to settle before changing the value.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '^[0-9]{4}$' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    // Only the fixed pattern reached onSubmit: the first Save was refused.
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(submitted(onSubmit, 0).regex).toBe('^[0-9]{4}$');
  });

  it('saves a pattern that compiles', async () => {
    const onSubmit = vi.fn();
    renderRule({ fieldType: 'postalCode', regex: '^[0-9]{5}$' }, onSubmit);
    fireEvent.change(screen.getByLabelText('Regex pattern'), {
      target: { value: '^(?:[1-9][0-9]{3}|[0-9]{4}-[0-9]{2}|[1-3][0-9]{4}-[0-9]{3})$' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(submitted(onSubmit, 0).regex).toBe('^(?:[1-9][0-9]{3}|[0-9]{4}-[0-9]{2}|[1-3][0-9]{4}-[0-9]{3})$');
  });

  it('leaves an empty value to the field\'s own required rule', () => {
    expect(regexCompiles('', {}, {} as never)).toBeUndefined();
    expect(regexCompiles(undefined, {}, {} as never)).toBeUndefined();
    expect(regexCompiles('(', {}, {} as never)).toMatch(/^Regex error:/);
  });
});
