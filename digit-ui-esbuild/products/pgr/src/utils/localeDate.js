/**
 * Dates in the language the user picked, not the browser's or date-fns'
 * English. ConvertTimestampToDate formats with date-fns and no locale, so a
 * French page read "13-Oct-2026".
 *
 * English keeps the d-MMM-yyyy every PGR screen already shows; any other
 * language gets its own month names and order from Intl. A locale Intl can't
 * read falls back to the English format.
 */
import { format, toDate } from "date-fns";

const ENGLISH_FORMAT = "d-MMM-yyyy";

// DIGIT locale codes are language_REGION (fr_FR); Intl wants fr-FR.
export const intlLocale = (locale) => (locale ? String(locale).replace("_", "-") : undefined);

const currentLocale = () =>
  typeof window !== "undefined" ? window.Digit?.StoreData?.getCurrentLanguage?.() : undefined;

export function formatLocaleDate(timestamp, locale = currentLocale()) {
  if (!timestamp) return "";
  const date = toDate(timestamp);
  if (!locale || String(locale).toLowerCase().startsWith("en")) return format(date, ENGLISH_FORMAT);
  try {
    return new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "short", year: "numeric" }).format(date);
  } catch (_) {
    return format(date, ENGLISH_FORMAT);
  }
}

/** Date or time parts for toLocale*String, in the user's language. */
export function formatLocaleParts(timestamp, options, kind = "date", locale = currentLocale()) {
  const date = new Date(timestamp);
  const tag = intlLocale(locale);
  try {
    return kind === "time" ? date.toLocaleTimeString(tag, options) : date.toLocaleDateString(tag, options);
  } catch (_) {
    return kind === "time" ? date.toLocaleTimeString(undefined, options) : date.toLocaleDateString(undefined, options);
  }
}
