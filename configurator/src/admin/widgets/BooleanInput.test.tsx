import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CoreAdminContext, Form, TestMemoryRouter, type DataProvider } from 'ra-core';
import { QueryClient } from '@tanstack/react-query';
import { BooleanInput } from './BooleanInput';

function renderToggle(record: Record<string, unknown>, onSubmit: (values: unknown) => void) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <TestMemoryRouter>
      <CoreAdminContext dataProvider={{} as DataProvider} queryClient={queryClient}>
        <Form record={record} onSubmit={onSubmit}>
          <BooleanInput source="VOICE_INPUT" label="Voice input" whenUnset />
          <button type="submit">Save</button>
        </Form>
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
}

const submitted = (onSubmit: ReturnType<typeof vi.fn>) => onSubmit.mock.calls[0][0] as Record<string, unknown>;

describe('BooleanInput whenUnset', () => {
  it('shows an unset flag as its meaning and writes nothing when left alone', async () => {
    const onSubmit = vi.fn();
    renderToggle({ code: 'DEFAULT', REOPENSLA: 259200000 }, onSubmit);
    expect(screen.getByRole('checkbox', { name: 'Voice input' })).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    // A tenant whose schema lacks the flag must not start sending it: the form
    // holds it undefined, which the JSON request body leaves out.
    expect(submitted(onSubmit).VOICE_INPUT).toBeUndefined();
    expect(JSON.parse(JSON.stringify(submitted(onSubmit)))).not.toHaveProperty('VOICE_INPUT');
  });

  it('writes false once the operator turns it off', async () => {
    const onSubmit = vi.fn();
    renderToggle({ code: 'DEFAULT', REOPENSLA: 259200000 }, onSubmit);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Voice input' }));
    expect(screen.getByRole('checkbox', { name: 'Voice input' })).not.toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(submitted(onSubmit).VOICE_INPUT).toBe(false);
  });

  it('shows a stored false as off', () => {
    renderToggle({ code: 'DEFAULT', REOPENSLA: 259200000, VOICE_INPUT: false }, vi.fn());
    expect(screen.getByRole('checkbox', { name: 'Voice input' })).not.toBeChecked();
  });
});
