/**
 * Spreadsheet cells for the dashboard export (#1977).
 *
 * Every cell keeps the exact text the screen shows. When that text is a
 * number, the cell also carries the number and an Excel format that prints
 * the same text again (same prefix and unit, decimals, digit grouping,
 * percent), so the sheet can be sorted and summed without drifting from the
 * screen. The format is read off the text itself rather than re-derived from
 * the value, so it can only ever say what the screen's formatter said.
 * Excel draws the separators of the reader's own locale.
 */

// The first number in the text: digits with any of the separators a
// dashboard number mask may use, starting and ending on a digit.
const NUMBER_RUN = /^(\D*?)(-?\d(?:[\d.,'_ \u00a0\u202f]*\d)?)([\s\S]*)$/;

/** A plain text cell. */
export function textCell(text) {
  return { text: text == null ? "" : String(text) };
}

/** A cell that links to another sheet of the workbook. */
export function linkCell(text, sheetName) {
  return { text: String(text), sheet: sheetName };
}

/**
 * A cell for text a number formatter produced ("13,8%", "2.033", "143,3 dias",
 * "4,0/5", "+12"). Dashboard formatters print at most two decimals and group
 * digits in threes, so the last separator is the decimal point exactly when
 * one or two digits follow it. Text with no number in it ("—") stays text.
 */
export function numberCell(text) {
  const s = text == null ? "" : String(text);
  const match = s.match(NUMBER_RUN);
  if (!match) return { text: s };
  const [, prefix, run] = match;
  let suffix = match[3];

  const negative = run.startsWith("-");
  const digits = negative ? run.slice(1) : run;
  const lastSeparator = digits.search(/[^\d](?=\d{1,2}$)/);
  const decimals = lastSeparator === -1 ? 0 : digits.length - lastSeparator - 1;
  const integerPart = lastSeparator === -1 ? digits : digits.slice(0, lastSeparator);
  const fraction = lastSeparator === -1 ? "" : digits.slice(lastSeparator + 1);
  const grouping = /\D/.test(integerPart);

  const percent = suffix.startsWith("%");
  if (percent) suffix = suffix.slice(1);
  // Built as a decimal string so 13,8% becomes exactly 0.138, not 13.8 / 100.
  const value = Number(
    `${negative ? "-" : ""}${integerPart.replace(/\D/g, "")}${fraction ? `.${fraction}` : ""}${percent ? "e-2" : ""}`
  );
  if (!Number.isFinite(value)) return { text: s };

  const numFmt =
    literal(prefix) +
    (grouping ? "#,##0" : "0") +
    (decimals ? `.${"0".repeat(decimals)}` : "") +
    (percent ? "%" : "") +
    literal(suffix);
  return { text: s, value, numFmt };
}

// Quoted literal text in an Excel number format. Formatter output never
// carries quotes or backslashes; drop them rather than break the format.
function literal(text) {
  return text ? `"${text.replace(/["\\]/g, "")}"` : "";
}
