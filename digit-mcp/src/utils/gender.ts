import type { MdmsRecord } from '../types/index.js';
import { ValidationError } from './validation.js';

export const GENDER_SCHEMA = 'common-masters.GenderType';

/** Codes of the active records of a `common-masters.GenderType` search. */
export function activeGenderCodes(records: MdmsRecord[]): string[] {
  return records
    .filter((r) => r.isActive !== false && (r.data as Record<string, unknown> | undefined)?.active !== false)
    .map((r) => String((r.data as Record<string, unknown> | undefined)?.code ?? r.uniqueIdentifier ?? ''))
    .filter(Boolean);
}

/**
 * Checks an optional gender against the tenant's GenderType master, so the
 * master, not this tool, decides which genders exist (#2397). Returns the
 * gender to send, or null when none was given.
 */
export async function validateGender(
  gender: unknown,
  tenantId: string,
  search: (tenantId: string, schemaCode: string) => Promise<MdmsRecord[]>,
  field = 'gender'
): Promise<string | null> {
  if (gender === undefined || gender === null || gender === '') return null;
  if (typeof gender !== 'string') throw new ValidationError(field, `${field} must be a string`);
  const stateRoot = tenantId.split('.')[0];
  const allowed = activeGenderCodes(await search(stateRoot, GENDER_SCHEMA));
  if (!allowed.includes(gender)) {
    throw new ValidationError(
      field,
      `${field} "${gender}" is not an active ${GENDER_SCHEMA} code on ${stateRoot}. ` +
      (allowed.length ? `Allowed: ${allowed.join(', ')}.` : `The master has no active genders; omit ${field}.`)
    );
  }
  return gender;
}
