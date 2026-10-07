import { readFileSync } from 'node:fs';

export interface CountryMobileRule {
  countryCode: string;
  mobileNumberRegex: string;
  default: true;
}

export interface PlatformSeed {
  version: string;
  founderRoles: string[];
  /** Defaults keyed by ISO country, not tenant IDs or dial codes. */
  countryMobileRules: Record<string, CountryMobileRule>;
  schemas: { code: string; definition: Record<string, unknown> }[];
  records: { schemaCode: string; uniqueIdentifier: string; data: Record<string, unknown> }[];
  /** Workflow business services, `{tenantid}`-templated; created by workflow-v2, not MDMS. */
  workflow?: Record<string, unknown>[];
}

/** Both source and published builds receive the same generated resource at build time. */
export function loadPlatformSeed(): PlatformSeed {
  const seed = JSON.parse(readFileSync(new URL('../data/platform-baseline-v1.json', import.meta.url), 'utf8')) as PlatformSeed;
  if (!/^[1-9][0-9]*$/.test(String(seed.version)) || !Array.isArray(seed.schemas) || !Array.isArray(seed.records)) {
    throw new Error('Unsupported platform baseline seed');
  }
  return seed;
}

export function substituteTenant<T>(value: T, tenant: string): T {
  if (typeof value === 'string') return value.replaceAll('{tenantid}', tenant) as T;
  if (Array.isArray(value)) return value.map((entry) => substituteTenant(entry, tenant)) as T;
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, substituteTenant(entry, tenant)])) as T;
  return value;
}
