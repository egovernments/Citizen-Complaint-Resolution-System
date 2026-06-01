import { useMemo } from 'react';
import { DigitCreate, DigitFormCodeInput, DigitFormInput, DigitFormSelect, v } from '@/admin';
import { useGetList } from 'ra-core';
import { useAvailableLocales } from '@/hooks/useAvailableLocales';

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
  const { locales } = useAvailableLocales();

  const moduleChoices = useMemo(() => {
    if (!data || data.length === 0) {
      return [{ value: DEFAULT_MODULE, label: DEFAULT_MODULE }];
    }
    const unique = [...new Set(data.map((r) => r.module))].filter(Boolean).sort();
    return unique.map((m) => ({ value: m, label: m }));
  }, [data]);

  const localeChoices = locales.map((l) => ({ value: l.value, label: l.label }));

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
        choices={localeChoices}
        placeholder="Select locale..."
      />
    </DigitCreate>
  );
}
