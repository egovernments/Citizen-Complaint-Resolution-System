import type { DigitColumn } from '../columns/types';
import { T } from './T';
import { columnLabelKey } from './columnLabelKey';

/** A column header's text: a `<T>` when it has a code, else the label as written. */
export function ColumnLabel({ column }: { column: Pick<DigitColumn, 'label' | 'labelKey'> }) {
  const key = columnLabelKey(column);
  return key ? <T i18nKey={key}>{column.label}</T> : <>{column.label}</>;
}
