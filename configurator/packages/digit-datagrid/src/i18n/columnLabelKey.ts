import type { DigitColumn } from '../columns/types';

/** A dotted code like `app.fields.sla` — never plain English copy. */
const CODE_RE = /^[\w-]+(\.[\w-]+)+$/;

/**
 * Localization code for a column header. Hand-written columns already pass a
 * code as `label`; schema-generated ones pass English ("Business Service"), so
 * derive the code from the field source instead (`businessService` →
 * `app.fields.business_service`), keeping the English label as the fallback.
 */
export function columnLabelKey(col: Pick<DigitColumn, 'source' | 'label'>): string {
  if (CODE_RE.test(col.label)) return col.label;
  return (
    'app.fields.' +
    col.source
      .replace(/\./g, '_')
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .toLowerCase()
  );
}
