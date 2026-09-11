import { useEffect } from 'react';
import { mdmsService } from '@/api';

/**
 * Mirror the tenant's MDMS-authored postal-code rule (a
 * `fieldType: "postalCode"` row in `common-masters.FormValidations`) onto
 * `window.__DIGIT_FORM_VALIDATIONS.postalCode` — a window channel named
 * after the master it mirrors, keyed by fieldType exactly like the rows
 * themselves, and shared with digit-ui's useMobileValidation so every
 * reader and writer speaks the master's name.
 *
 * The `v.postalCode` validator (admin/validation.ts) re-resolves this channel
 * on every keystroke, so mounting this hook next to a postal field is enough:
 * once the fetch lands, validation silently upgrades from the globalConfigs
 * pattern to the MDMS one. MDMS is the primary per-tenant knob — DDH seeds a
 * default 5-digit row at tenant creation, editable in Studio's
 * FormValidations editor. A missing row (dump-booted stacks,
 * pre-FormValidations tenants), a failed fetch, or an unregistered
 * FormValidations schema all leave the channel EMPTY — the validator then
 * falls back to globalConfigs CORE_POSTAL_CONFIGS exactly as before, so this
 * can never brick the form.
 *
 * The key is cleared on tenant switch (and when the row disappears) so a
 * previous tenant's rule can't leak into the next one's forms.
 */
export function usePostalRule(tenantId: string): void {
  useEffect(() => {
    if (!tenantId || typeof window === 'undefined') return;
    let cancelled = false;

    const channel = () => {
      const w = window as unknown as {
        __DIGIT_FORM_VALIDATIONS?: Record<string, { pattern: string } | undefined>;
      };
      w.__DIGIT_FORM_VALIDATIONS = w.__DIGIT_FORM_VALIDATIONS || {};
      return w.__DIGIT_FORM_VALIDATIONS;
    };

    // Clear any previous tenant's rule immediately — globalConfigs (already
    // tenant-correct) covers the gap until this tenant's row, if any, lands.
    delete channel().postalCode;

    mdmsService
      .getPostalValidation(tenantId)
      .then((rule) => {
        if (cancelled) return;
        if (rule?.pattern) channel().postalCode = { pattern: rule.pattern };
      })
      .catch(() => {
        // Unseeded/unregistered master or a transient MDMS error — the
        // channel stays empty and validation falls back to globalConfigs.
      });

    return () => {
      cancelled = true;
    };
  }, [tenantId]);
}
