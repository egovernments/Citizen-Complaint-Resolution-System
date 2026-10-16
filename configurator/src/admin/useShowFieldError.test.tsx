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

it('outside a form (an input rendered alone) it falls back to touched / changed', () => {
  function Alone() { return <span>{String(useShowFieldError({ invalid: true, isTouched: false }))}</span>; }
  render(<Alone />);
  expect(screen.getByText('false')).toBeTruthy();
});

it('no input gates its error on touched only any more', async () => {
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const { join, resolve } = await import('node:path');
  const root = resolve(__dirname, '..');
  const hits: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(n) && !/\.test\./.test(n) && /fieldState\.invalid && fieldState\.isTouched/.test(readFileSync(p, 'utf8'))) hits.push(p.slice(root.length));
    }
  };
  walk(root);
  expect(hits).toEqual([]);
});
