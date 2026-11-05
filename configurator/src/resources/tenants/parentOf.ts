/** ours (cfgreview F07, #1554): a tenant's parent is its code without the last segment ('' for a state). */
export function parentOf(code: string): string {
  const i = code.lastIndexOf('.');
  return i > 0 ? code.slice(0, i) : '';
}
