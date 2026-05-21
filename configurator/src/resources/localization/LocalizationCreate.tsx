import { useMemo } from 'react';
import { DigitCreate, DigitFormCodeInput, DigitFormInput, DigitFormSelect, v } from '@/admin';
import { useGetList } from 'ra-core';

const LOCALE_CHOICES = [
  { value: 'en_IN', label: 'English (en_IN)' },
  { value: 'hi_IN', label: 'Hindi (hi_IN)' },
  { value: 'mr_IN', label: 'Marathi (mr_IN)' },
  { value: 'kn_IN', label: 'Kannada (kn_IN)' },
  { value: 'ta_IN', label: 'Tamil (ta_IN)' },
];

const DEFAULT_MODULE = 'rainmaker-common';

const defaultRecord = {
  locale: 'en_IN',
  module: DEFAULT_MODULE,
};

export function LocalizationCreate() {
  const { data } = useGetList('localization', {
    pagination: { page: 1, perPage: 1000 },
    sort: { field: 'module', order: 'ASC' },
  });

  const moduleChoices = useMemo(() => {
    if (!data || data.length === 0) {
      return [{ value: DEFAULT_MODULE, label: DEFAULT_MODULE }];
    }
    const unique = [...new Set(data.map((r) => r.module))].filter(Boolean).sort();
    return unique.map((m) => ({ value: m, label: m }));
  }, [data]);

  return (
    <DigitCreate title="Create Localization Message" record={defaultRecord}>
      <DigitFormCodeInput source="code" label="Code" validate={v.codeRequired} />
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
    </DigitCreate>
  );
}
