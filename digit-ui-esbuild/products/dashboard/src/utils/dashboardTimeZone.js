/**
 * Deterministic, zone-safe calendar-date math for the dashboard's default
 * date-range filters and "Last updated" stamp (#29 timezone addendum).
 *
 * Mirrors the backend's BusinessCalendar (org.egov.pgr.analytics.BusinessCalendar):
 * every calendar day is derived from Intl.DateTimeFormat#formatToParts in the
 * RESOLVED zone, never the browser's local zone, never UTC-as-a-stand-in. No
 * module-global mutable zone state lives here — callers thread the resolved
 * zone string through explicitly.
 */

/** Documented migration-compatibility fallback zone, matching BusinessCalendar.DEFAULT_ZONE. */
export const DEFAULT_TIME_ZONE = "Africa/Nairobi";

/** Defensive IANA zone-id validation via the runtime's own Intl database. */
export function isValidTimeZone(timeZone) {
  if (typeof timeZone !== "string" || !timeZone.trim()) return false;
  try {
    // eslint-disable-next-line no-new -- constructing throws RangeError on an invalid zone id
    new Intl.DateTimeFormat("en-US", { timeZone: timeZone.trim() });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve `dashboardConfig.timeZone` (dss.DashboardConfig) to a validated
 * IANA zone id, falling back to DEFAULT_TIME_ZONE exactly like the backend's
 * KpiCatalogService.resolveTimeZone — absent, empty, or invalid all resolve
 * the same way, never to the browser's local zone.
 */
export function resolveConfiguredTimeZone(dashboardConfig) {
  const raw = dashboardConfig?.timeZone;
  return isValidTimeZone(raw) ? raw.trim() : DEFAULT_TIME_ZONE;
}

function zonedDateParts(date, timeZone) {
  const zone = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
  const instant = date instanceof Date ? date : new Date(date);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const out = {};
  for (const part of parts) {
    if (part.type !== "literal") out[part.type] = Number(part.value);
  }
  return out; // { year, month, day } — month is 1-12
}

function formatYMD(year, month, day) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Days in `month` (1-12) of `year` — a neutral UTC pivot, no zone conversion involved. */
function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** yyyy-MM-dd for `date` (a Date instance or epoch ms) as a calendar day in `timeZone`. */
export function zonedYMD(date, timeZone) {
  const { year, month, day } = zonedDateParts(date, timeZone);
  return formatYMD(year, month, day);
}

/**
 * yyyy-MM-dd one calendar month before `date`'s zoned calendar day, clamped to
 * the shorter target month's last day (e.g. Mar 31 -> Feb 28, or Feb 29 in a
 * leap year). Computed entirely from the zoned {year,month,day} triple, so it
 * never leaks the browser's local zone into the result.
 */
export function oneMonthEarlierYMD(date, timeZone) {
  const { year, month, day } = zonedDateParts(date, timeZone);
  let targetYear = year;
  let targetMonth = month - 1;
  if (targetMonth < 1) {
    targetMonth = 12;
    targetYear -= 1;
  }
  const clampedDay = Math.min(day, daysInMonth(targetYear, targetMonth));
  return formatYMD(targetYear, targetMonth, clampedDay);
}
