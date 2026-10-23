/** The key a new Map Configuration record takes when the form names none. */
export const MAP_CONFIG_DEFAULT_CODE = 'DEFAULT';

/**
 * ours (#1685): the code a Map Configuration save writes. An existing row (this tenant's, or the parent's it shadows)
 * keeps its own code - its unique key, which MDMS refuses to change (UNIQUE_KEY_UPDATE_ERR) - so a variant other than
 * DEFAULT stays editable. A new record takes the form's code, else DEFAULT.
 */
export function mapConfigCode(record: { data?: Record<string, unknown> } | null | undefined, data: Record<string, unknown>): string {
  const own = record?.data?.code;
  if (typeof own === 'string' && own.trim()) return own;
  const typed = data.code;
  return typeof typed === 'string' && typed.trim() ? typed.trim() : MAP_CONFIG_DEFAULT_CODE;
}
