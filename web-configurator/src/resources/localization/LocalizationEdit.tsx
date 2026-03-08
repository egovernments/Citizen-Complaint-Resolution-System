import { DigitEdit, DigitFormInput } from '@/admin';
import { required } from 'ra-core';

export function LocalizationEdit() {
  return (
    <DigitEdit title="Edit Localization Message">
      <DigitFormInput source="code" label="Code" disabled />
      <DigitFormInput source="message" label="Message" validate={required()} />
      <DigitFormInput source="module" label="Module" validate={required()} />
      <DigitFormInput source="locale" label="Locale" />
    </DigitEdit>
  );
}
