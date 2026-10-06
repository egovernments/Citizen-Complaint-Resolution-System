/** Every IANA zone the runtime knows, sorted. Native `<select>` already gives keyboard
 *  type-ahead search over this — no separate combobox needed. */
export function listTimeZones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone').sort();
  } catch {
    return [];
  }
}
