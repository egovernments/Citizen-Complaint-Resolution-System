import { useRecordContext } from 'ra-core';
import { DigitFormSelect } from '@/admin';
import { useParentChoices } from './parentChoices';

/** ours#861 A3: the sub-type's parent, picked from the existing categories (the record's own parent stays offered). */
export function ParentCodeSelect() {
  const record = useRecordContext();
  const current = typeof record?.parentCode === 'string' ? record.parentCode : undefined;
  const choices = useParentChoices(current);
  return <DigitFormSelect source="parentCode" label="Parent (category)" choices={choices} placeholder="Select the category..." />;
}
