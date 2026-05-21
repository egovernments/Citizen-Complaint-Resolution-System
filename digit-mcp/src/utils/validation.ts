/**
 * Input validation utilities for agent-safety hardening.
 * Agents hallucinate malformed inputs — these validators are the last line of defense.
 */

export class ValidationError extends Error {
  constructor(public field: string, message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

// Tenant ID: lowercase segments separated by dots. Each segment starts with
// a letter and may contain lowercase letters, digits, and hyphens (DIGIT
// itself accepts hyphenated city tenants like "ke.poc-mzpt").
const TENANT_ID_RE = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/;

// Resource ID: no query params, fragments, or percent-encoding
const RESOURCE_ID_UNSAFE = /[?#%]/;

// Control chars below ASCII 0x20 except newline (0x0a) and tab (0x09)
const CONTROL_CHAR_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f]/;

export function validateTenantId(id: unknown, field = 'tenant_id'): string {
  if (typeof id !== 'string' || !id) {
    throw new ValidationError(field, `${field} is required and must be a non-empty string`);
  }
  if (!TENANT_ID_RE.test(id)) {
    throw new ValidationError(
      field,
      `${field} "${id}" is invalid. Must be lowercase alphanumeric segments separated by dots (e.g. "pg", "pg.citya"). Got characters that don't match pattern.`
    );
  }
  if (id.length > 50) {
    throw new ValidationError(field, `${field} exceeds max length of 50 characters`);
  }
  return id;
}

export function validateMobileNumber(num: unknown, field = 'mobile_number'): string {
  if (typeof num !== 'string' || !num) {
    throw new ValidationError(field, `${field} is required`);
  }
  const cleaned = num.replace(/[\s\-()+]/g, '');
  // Country-agnostic: the per-tenant common-masters.UserValidation 'mobile'
  // rule (egov-user) is the source of truth for the exact pattern/length.
  // Don't hardcode India's 10-digit here — that rejects Kenya (9, starts 1/7),
  // Mozambique (9, starts 8), etc. before the request even reaches the backend.
  // Just sanity-check it's digits of a plausible length; the backend enforces
  // the tenant's real rule.
  if (!/^\d{6,15}$/.test(cleaned)) {
    throw new ValidationError(
      field,
      `${field} must be 6-15 digits. Got "${num}" (${cleaned.length} digits after cleanup). ` +
      `The tenant's common-masters.UserValidation 'mobile' rule enforces the exact pattern.`
    );
  }
  return cleaned;
}

export function rejectControlChars(str: unknown, field: string): string {
  if (typeof str !== 'string') return '';
  if (CONTROL_CHAR_RE.test(str)) {
    throw new ValidationError(
      field,
      `${field} contains invalid control characters. Only printable characters, newlines, and tabs are allowed.`
    );
  }
  return str;
}

export function validateStringLength(str: unknown, maxLen: number, field: string): string {
  if (typeof str !== 'string') return '';
  if (str.length > maxLen) {
    throw new ValidationError(
      field,
      `${field} exceeds max length of ${maxLen} characters (got ${str.length}).`
    );
  }
  return str;
}

export function validateResourceId(id: unknown, field: string): string {
  if (typeof id !== 'string' || !id) {
    throw new ValidationError(field, `${field} is required and must be a non-empty string`);
  }
  if (RESOURCE_ID_UNSAFE.test(id)) {
    throw new ValidationError(
      field,
      `${field} "${id}" contains invalid characters (?, #, or %). Resource IDs must not contain query parameters or URL encoding.`
    );
  }
  return id;
}

/**
 * Validate common tool inputs. Call at the top of any tool handler.
 * Returns validated values. Throws ValidationError with clear message on failure.
 */
export function validateToolInputs(
  args: Record<string, unknown>,
  specs: Array<
    | { key: string; type: 'tenant_id' }
    | { key: string; type: 'mobile' }
    | { key: string; type: 'resource_id' }
    | { key: string; type: 'string'; maxLen?: number; required?: boolean }
  >
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const spec of specs) {
    const val = args[spec.key];
    switch (spec.type) {
      case 'tenant_id':
        out[spec.key] = validateTenantId(val, spec.key);
        break;
      case 'mobile':
        out[spec.key] = validateMobileNumber(val, spec.key);
        break;
      case 'resource_id':
        out[spec.key] = validateResourceId(val, spec.key);
        break;
      case 'string': {
        const s = rejectControlChars(val, spec.key);
        if (spec.required && !s) {
          throw new ValidationError(spec.key, `${spec.key} is required`);
        }
        out[spec.key] = validateStringLength(s, spec.maxLen || 2000, spec.key);
        break;
      }
    }
  }
  return out;
}
