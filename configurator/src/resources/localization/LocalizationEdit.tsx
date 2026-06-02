import { useMemo } from 'react';
import { DigitEdit, DigitFormInput, DigitFormSelect, v } from '@/admin';
import { useGetList } from 'ra-core';
import { useAvailableLocales } from '@/hooks/useAvailableLocales';

export function LocalizationEdit() {
  const { data } = useGetList('localization', {
    pagination: { page: 1, perPage: 1000 },
    sort: { field: 'module', order: 'ASC' },
  });
  const { locales } = useAvailableLocales();

  const moduleChoices = useMemo(() => {
    if (!data || data.length === 0) {
      return [{ value: 'rainmaker-common', label: 'rainmaker-common' }];
    }
    const unique = [...new Set(data.map((r) => r.module))].filter(Boolean).sort();
    return unique.map((m) => ({ value: m, label: m }));
  }, [data]);

  const localeChoices = locales.map((l) => ({ value: l.value, label: l.label }));

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
        choices={localeChoices}
        placeholder="Select locale..."
      />
    </DigitEdit>
  );
}
