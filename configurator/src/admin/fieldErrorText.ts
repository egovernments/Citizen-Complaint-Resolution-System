import { useTranslate } from 'ra-core';

/** ra-core v5 stores its own validators' errors as `@@react-admin@@<JSON>` in react-hook-form state (useInput). */
const RA_PREFIX = '@@react-admin@@';

export interface DecodedFieldError { message: string; args?: Record<string, unknown> }

/** The message key (or text) and its args inside a field error; undefined when there is none. */
export function decodeFieldError(raw: unknown): DecodedFieldError | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  if (!raw.startsWith(RA_PREFIX)) return { message: raw };
  const body = raw.slice(RA_PREFIX.length);
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === 'string') return { message: parsed };
    if (parsed && typeof parsed === 'object' && 'message' in parsed) {
      const p = parsed as { message: unknown; args?: Record<string, unknown> };
      return { message: String(p.message), args: p.args };
    }
    return { message: String(parsed) };
  } catch {
    return { message: body };
  }
}

/**
 * The text a field shows for its error - decoded AND translated, as ra-core's
 * own ValidationError does. The inputs rendered the stored error message as is, so a validator's error appeared as
 * the raw `@@react-admin@@{"message":"ra.validation.required",...}` (and DigitFormInput, which decoded it, showed the
 * untranslated key `ra.validation.required`).
 */
export function useFieldErrorText(raw: unknown): string | undefined {
  const translate = useTranslate();
  const d = decodeFieldError(raw);
  if (!d) return undefined;
  return translate(d.message, { _: d.message, ...(d.args ?? {}) });
}
