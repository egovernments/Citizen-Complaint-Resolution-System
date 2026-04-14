import { useMemo } from 'react';
import { DigitEdit, DigitFormInput, DigitFormSelect, v } from '@/admin';
import { useGetList } from 'ra-core';

const LOCALE_CHOICES = [
  { value: 'en_IN', label: 'English (en_IN)' },
  { value: 'hi_IN', label: 'Hindi (hi_IN)' },
  { value: 'mr_IN', label: 'Marathi (mr_IN)' },
  { value: 'kn_IN', label: 'Kannada (kn_IN)' },
  { value: 'ta_IN', label: 'Tamil (ta_IN)' },
];

export function LocalizationEdit() {
  const { data } = useGetList('localization', {
    pagination: { page: 1, perPage: 1000 },
    sort: { field: 'module', order: 'ASC' },
  });

  const moduleChoices = useMemo(() => {
    if (!data || data.length === 0) {
      return [{ value: 'rainmaker-common', label: 'rainmaker-common' }];
    }
    const unique = [...new Set(data.map((r) => r.module))].filter(Boolean).sort();
    return unique.map((m) => ({ value: m, label: m }));
  }, [data]);

  return (
    <DigitEdit title="Edit Localization Message">
      <DigitFormInput source="code" label="Code" disabled />
      <DigitFormInput source="message" label="Message" validate={v.required} />
      <DigitFormSelect
        source="module"
        label="Module"
        choices={moduleChoices}
        placeholder="Select module..."
        validate={v.required}
      />
      <DigitFormSelect
        source="locale"
        label="Locale"
        choices={LOCALE_CHOICES}
        placeholder="Select locale..."
      />
    </DigitEdit>
  );
}
