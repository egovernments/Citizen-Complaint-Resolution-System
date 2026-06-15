import { useMemo } from 'react';
import { DigitCreate, DigitFormCodeInput, DigitFormInput, DigitFormSelect, v } from '@/admin';
import { useAvailableLocales } from '@/hooks/useAvailableLocales';
import { useLocalizationModules } from '@/hooks/useLocalizationModules';

const DEFAULT_MODULE = 'rainmaker-common';

const defaultRecord = {
  locale: 'en_IN',
  module: DEFAULT_MODULE,
};

export function LocalizationCreate() {
  // Module options come from the localization data itself (distinct modules
  // across all messages for the locale), via useLocalizationModules — not the
  // list view's paginated rows, which truncate at perPage and drop modules.
  const { modules } = useLocalizationModules(defaultRecord.locale);
  const { locales } = useAvailableLocales();

  const moduleChoices = useMemo(
    () => modules.map((m) => ({ value: m, label: m })),
    [modules],
  );

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
