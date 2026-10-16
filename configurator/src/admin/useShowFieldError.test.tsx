import { act, fireEvent, render, screen } from '@testing-library/react';
import { FormProvider, useController, useForm } from 'react-hook-form';
import { expect, it } from 'vitest';
import { useShowFieldError } from './useShowFieldError';

// a blank Create refused silently - no field said it was required until touched
function Field() {
  const { fieldState } = useController({ name: 'code', rules: { required: 'Code is required' } });
  const show = useShowFieldError(fieldState);
  return show ? <p role="alert">{fieldState.error?.message}</p> : null;
}
function Harness() {
  const form = useForm({ defaultValues: { code: '' } });
  return (
    <FormProvider {...form}>
      <form onSubmit={form.handleSubmit(() => {})}><Field /><button type="submit">Create</button></form>
    </FormProvider>
  );
}

it('a blank submit shows the required field error without the field being touched', async () => {
  render(<Harness />);
  expect(screen.queryByRole('alert')).toBeNull();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Create' })); });
  expect(screen.getByRole('alert').textContent).toMatch(/required/i);
});
