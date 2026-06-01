/**
 * Environment configuration — all env vars with defaults.
 *
 * Every test reads from here, not from process.env directly.
 * This ensures consistent defaults and documents what's configurable.
 */

export const BASE_URL = process.env.BASE_URL || 'https://naipepea.digit.org';
export const TENANT = process.env.DIGIT_TENANT || 'ke.nairobi';
export const ROOT_TENANT = process.env.ROOT_TENANT || (TENANT.includes('.') ? TENANT.split('.')[0] : TENANT);
export const ADMIN_USER = process.env.DIGIT_USERNAME || 'ADMIN';
export const ADMIN_PASS = process.env.DIGIT_PASSWORD || 'eGov@123';
export const FIXED_OTP = process.env.FIXED_OTP || '123456';
export const CITIZEN_PHONE_PREFIX = process.env.CITIZEN_PHONE_PREFIX || '7';
export const SERVICE_CODE = process.env.SERVICE_CODE || 'IllegalConstruction';
export const LOCALITY_CODE = process.env.LOCALITY_CODE || 'NAIROBI_CITY_VIWANDANI';
export const DEFAULT_PASSWORD = 'eGov@123';

/**
 * Non-ADMIN persona usernames + boundary codes for the 2026-05/06
 * validation suite. Defaults match the bomet ke deployment; override
 * via env on any other tenant.
 */

/** PGR_LME / GRO employee for digit-ui employee flows (escalate, inbox). */
export const EMPLOYEE_USER = process.env.EMPLOYEE_USER || 'BOMET_LME';
export const EMPLOYEE_PASS = process.env.EMPLOYEE_PASSWORD || DEFAULT_PASSWORD;

/** Ward-scoped CSR for boundary jurisdiction-filter regression. */
export const WARD_CSR_USER = process.env.WARD_CSR_USER || 'BOMET_CSR_CHESOEN_1780282462';
export const WARD_CSR_PASS = process.env.WARD_CSR_PASSWORD || DEFAULT_PASSWORD;

/** The leaf ward this CSR is scoped to. */
export const WARD_CSR_BOUNDARY = process.env.WARD_CSR_BOUNDARY || 'BOMET_BOMET_CENTRAL_CHESOEN';

/**
 * Sibling / cross-sub-county wards that MUST NOT appear in the CSR's
 * boundary picker. Comma-separated. Defaults are bomet wards adjacent
 * to CHESOEN.
 */
export const FORBIDDEN_WARDS = (
  process.env.FORBIDDEN_WARDS ||
  'BOMET_BOMET_CENTRAL_MUTARAKWA,BOMET_BOMET_CENTRAL_NADARAWETA,BOMET_BOMET_CENTRAL_SILIBWET_TOWNSHIP,BOMET_BOMET_CENTRAL_SINGORWET,BOMET_BOMET_EAST_KEMBU,BOMET_CHEPALUNGU_CHEBUNYO,BOMET_KONOIN_KIMULOT'
).split(',').map((s) => s.trim()).filter(Boolean);

/** Tenant display label on digit-ui login City combobox. */
export const TENANT_LABEL = process.env.TENANT_LABEL || 'Bomet County';

/** Known complaint that is assigned to EMPLOYEE_USER on the deployment. */
export const ASSIGNED_COMPLAINT_ID = process.env.ASSIGNED_COMPLAINT_ID || 'PG-PGR-2026-04-13-000848';

/** Generate a unique citizen phone number valid for the deployment's mobile validation */
export function generateCitizenPhone(): string {
  // Prefix + remaining digits from timestamp to ensure uniqueness
  const remaining = 9 - CITIZEN_PHONE_PREFIX.length;
  return CITIZEN_PHONE_PREFIX + Date.now().toString().slice(-remaining);
}

/** Generate a unique employee phone number */
export function generateEmployeePhone(): string {
  const remaining = 9 - CITIZEN_PHONE_PREFIX.length;
  return CITIZEN_PHONE_PREFIX + (Date.now() + 1).toString().slice(-remaining);
}
