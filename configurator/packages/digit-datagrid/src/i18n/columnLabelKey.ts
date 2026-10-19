import type { DigitColumn } from '../columns/types';

/** A dotted code like `app.fields.sla` — never plain English copy. */
const CODE_RE = /^[\w-]+(\.[\w-]+)+$/;

/** Whether `text` is a localization code rather than plain English copy. */
export function isI18nCode(text: string): boolean {
  return CODE_RE.test(text);
}

/**
 * The shared code a schema field's label is looked up under:
 * `businessService` → `app.fields.business_service`.
 */
export function fieldLabelKey(source: string): string {
  return (
    'app.fields.' +
    source
      .replace(/\./g, '_')
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .toLowerCase()
  );
}

/**
 * Localization code for a column header: the column's `labelKey` (set by the
 * schema column generators), else its `label` when that is already a code.
 * A hand-written English label ("Employee Code") has no code, so it gets none
 * and renders exactly as written.
 */
export function columnLabelKey(col: Pick<DigitColumn, 'label' | 'labelKey'>): string | undefined {
  if (col.labelKey) return col.labelKey;
  return isI18nCode(col.label) ? col.label : undefined;
}
