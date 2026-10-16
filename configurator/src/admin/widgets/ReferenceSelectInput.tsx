import { useMemo } from 'react';
import { useGetList } from 'ra-core';
import { useWatch } from 'react-hook-form';
import { DigitFormInput } from '../DigitFormInput';
import { DigitFormSelect } from '../DigitFormSelect';
import { uniqueBy } from '@/lib/uniqueBy';

export interface ReferenceSelectInputProps {
  source: string;
  label: string;
  help?: string;
  /** Resource whose records become the choices. */
  reference: string;
  /** Field submitted (default 'code'). */
  optionValue?: string;
  /** Field displayed (default 'name'). */
  optionText?: string;
}

/**
 * Descriptor widget: a dropdown fed from another resource, for a field whose
 * legal values are a master somewhere else. Used for `eventName` on the raw
 * notification masters, where a typo used to be indistinguishable from a
 * correct entry until nothing was ever delivered.
 *
 * Two deliberate differences from a plain `<DigitFormSelect reference=…>`:
 *
 *  - **The record's current value is always a choice**, even when the referenced
 *    master no longer lists it. Otherwise opening an old row shows an empty
 *    dropdown, and the operator cannot tell "this row names an event that is
 *    gone" from "the list has not loaded".
 *  - **It degrades to a text input** when the referenced master cannot be read
 *    or is empty. This is the raw form, the one that exists for bulk and unusual
 *    edits; an un-fillable dropdown would be a worse failure than free text, and
 *    the save guard rejects an unknown event anyway.
 */
export function ReferenceSelectInput({
  source,
  label,
  help,
  reference,
  optionValue = 'code',
  optionText = 'name',
}: ReferenceSelectInputProps) {
  const { data, isLoading, error } = useGetList(reference, {
    pagination: { page: 1, perPage: 1000 },
    sort: { field: optionValue, order: 'ASC' },
  });

  const current = useWatch({ name: source }) as unknown;
  const currentValue = current == null ? '' : String(current);

  const choices = useMemo(() => {
    const fromReference = (data ?? []).map((item) => {
      const value = String((item as Record<string, unknown>)[optionValue] ?? item.id ?? '');
      const text = String((item as Record<string, unknown>)[optionText] ?? value);
      return { value, label: text === value ? value : `${text} — ${value}` };
    }).filter((c) => c.value !== '');
    const known = fromReference.some((c) => c.value === currentValue);
    const all = currentValue && !known
      ? [{ value: currentValue, label: `${currentValue} (not in the list)` }, ...fromReference]
      : fromReference;
    return uniqueBy(all, (c) => c.value);
  }, [data, optionValue, optionText, currentValue]);

  if (error || (!isLoading && choices.length === 0)) {
    return <DigitFormInput source={source} label={label} type="text" help={help} />;
  }

  return (
    <DigitFormSelect
      source={source}
      label={label}
      help={help}
      choices={choices}
      placeholder={isLoading ? 'Loading...' : `Select ${label.toLowerCase()}...`}
    />
  );
}
