// SMS character-set detection + segment arithmetic (3GPP TS 23.038).
//
// Pure and React-free so validateNotifications can use it and so it can be
// unit-tested on its own. Nothing here talks to MDMS or the provider.
//
// WHY THIS EXISTS
//   An SMS is billed per SEGMENT, not per message. A body that fits in one
//   segment in English can cost five in Hindi, because a single non-GSM-7
//   character forces the whole message to UCS-2 (70 chars per segment instead
//   of 160). Operators author these bodies in the configurator with no idea of
//   that cliff, so the validator warns when a template is about to become an
//   expensive multi-part send.
//
// WHAT WE MEASURE
//   The template body EXACTLY AS AUTHORED — placeholders left in place — plus
//   SMS_PLACEHOLDER_ALLOWANCE extra characters for every `{placeholder}`
//   occurrence. The allowance exists because at send time `{id}` (4 characters)
//   becomes something like `PGR-2026-09-21-000123` (21). It is a deliberately
//   rough, single documented number rather than a per-token table: we cannot
//   know a tenant's real complaint-type labels or employee names, and the
//   warning threshold (above 3 segments) is generous enough that the exact
//   allowance only matters for borderline bodies.
//
//   This is an ESTIMATE and the rule is a WARNING for that reason. It does NOT
//   mean the message will be rejected, and it is not a billing figure.

/**
 * GSM 03.38 default alphabet (the 128 characters an SMS can carry at 7 bits
 * each). The ESC byte (0x1B) that introduces the extension table is excluded —
 * extension characters are handled by GSM7_EXTENDED below.
 */
export const GSM7_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?' +
  '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';

/**
 * GSM 03.38 extension table. These ARE sendable as GSM-7 but cost TWO septets
 * each (ESC + the character). Note `{` and `}` are in here, so every
 * placeholder's braces already cost 2 units apiece — one more reason the
 * allowance above is approximate in the safe direction.
 */
export const GSM7_EXTENDED = '\f^{}\\[~]|€';

/** Septets in a single, non-concatenated GSM-7 message. */
export const SMS_SINGLE_GSM7 = 160;
/** Septets per part once a GSM-7 message is concatenated (7 lost to the UDH). */
export const SMS_CONCAT_GSM7 = 153;
/** UTF-16 code units in a single, non-concatenated UCS-2 message. */
export const SMS_SINGLE_UCS2 = 70;
/** UTF-16 code units per part once a UCS-2 message is concatenated. */
export const SMS_CONCAT_UCS2 = 67;

/**
 * Extra characters charged per `{placeholder}` occurrence, on top of the token
 * text itself. See the header note: one documented number, not a per-token
 * table.
 */
export const SMS_PLACEHOLDER_ALLOWANCE = 12;

/** Above this many estimated segments the validator warns. */
export const SMS_SEGMENT_WARN_ABOVE = 3;

const BASIC = new Set(GSM7_BASIC);
const EXTENDED = new Set(GSM7_EXTENDED);

/** Matches the same single-brace placeholder shape pgr-services substitutes. */
const PLACEHOLDER_RE = /\{[a-zA-Z0-9_]+\}/g;

export interface SmsMeasurement {
  /** Encoding the whole message is forced into by its "worst" character. */
  encoding: 'GSM-7' | 'UCS-2';
  /** Billable units INCLUDING the placeholder allowance. */
  units: number;
  /** Units contributed by the authored text alone (no allowance). */
  authoredUnits: number;
  /** Number of `{placeholder}` occurrences counted (repeats count each time). */
  placeholders: number;
  /** Allowance units added on top of `authoredUnits`. */
  allowance: number;
  /** Estimated segments this message is sent in. 0 only for an empty body. */
  segments: number;
  /** The first character that forced UCS-2, when it did. Useful in a message. */
  forcedUcs2By?: string;
}

/** True when every character of `text` is sendable in GSM-7 (basic or extended). */
export function isGsm7(text: string): boolean {
  return firstNonGsm7(text) === undefined;
}

/** The first character of `text` that GSM-7 cannot carry, or undefined. */
export function firstNonGsm7(text: string): string | undefined {
  // Iterate by code POINT: an astral character (emoji) is a single symbol but
  // two UTF-16 code units, and either way it is not GSM-7.
  for (const ch of text) {
    if (!BASIC.has(ch) && !EXTENDED.has(ch)) return ch;
  }
  return undefined;
}

/**
 * Measure an SMS body the way a gateway would bill it, plus the documented
 * placeholder allowance. Pure; `body` is used exactly as given.
 */
export function measureSms(
  body: string,
  options: { allowancePerPlaceholder?: number } = {},
): SmsMeasurement {
  const text = body ?? '';
  const allowancePerPlaceholder =
    options.allowancePerPlaceholder ?? SMS_PLACEHOLDER_ALLOWANCE;
  const placeholders = (text.match(PLACEHOLDER_RE) ?? []).length;
  const allowance = placeholders * allowancePerPlaceholder;

  const offender = firstNonGsm7(text);
  if (offender === undefined) {
    let authoredUnits = 0;
    for (const ch of text) authoredUnits += EXTENDED.has(ch) ? 2 : 1;
    const units = authoredUnits + allowance;
    return {
      encoding: 'GSM-7',
      units,
      authoredUnits,
      placeholders,
      allowance,
      segments: segmentsFor(units, SMS_SINGLE_GSM7, SMS_CONCAT_GSM7),
    };
  }

  // UCS-2 is billed in UTF-16 code units, so a surrogate pair costs 2.
  const authoredUnits = text.length;
  const units = authoredUnits + allowance;
  return {
    encoding: 'UCS-2',
    units,
    authoredUnits,
    placeholders,
    allowance,
    segments: segmentsFor(units, SMS_SINGLE_UCS2, SMS_CONCAT_UCS2),
    forcedUcs2By: offender,
  };
}

function segmentsFor(units: number, single: number, concat: number): number {
  if (units <= 0) return 0;
  if (units <= single) return 1;
  return Math.ceil(units / concat);
}
