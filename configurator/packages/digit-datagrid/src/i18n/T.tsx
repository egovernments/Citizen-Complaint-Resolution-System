import { useTranslate } from 'ra-core';

export interface TProps {
  /** Localization code, e.g. `app.fields.sla`. */
  i18nKey: string;
  /** Interpolation values, e.g. `{ count: 5 }` for `%{count} days`. */
  options?: Record<string, unknown>;
  /** Fallback text shown when the code isn't seeded. */
  children?: string;
}

/**
 * Translated text that carries its localization code in the DOM:
 * `<span data-i18n-key="app.fields.sla">SLA</span>`. Right-click → Inspect on
 * any string rendered through this shows the code to look up (and edit) under
 * System → Localization, so relabelling UI copy doesn't need a developer.
 *
 * Same props as ra-core's `<Translate>`. For strings rendered into attributes
 * (placeholder, title) a span can't go there — put the code on the element as
 * `data-i18n-key-<attr>` instead, e.g. `data-i18n-key-placeholder`.
 */
export function T({ i18nKey, options, children }: TProps) {
  const translate = useTranslate();
  return (
    <span data-i18n-key={i18nKey}>
      {translate(i18nKey, children === undefined ? options : { ...options, _: children })}
    </span>
  );
}
