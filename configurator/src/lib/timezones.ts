/** Every IANA zone the runtime knows, sorted alphabetically. */
export function listTimeZones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone').sort();
  } catch {
    return [];
  }
}
