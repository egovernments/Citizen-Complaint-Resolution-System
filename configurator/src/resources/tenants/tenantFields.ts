// tenant.tenants `pincode` is a number[] in the schema; the chip editor works on strings. The form shows the
// numbers as strings and saves numbers back; anything that is not a whole non-negative number is dropped.
export function formatPincodes(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => String(v)) : [];
}

export function parsePincodes(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const out: number[] = [];
  for (const v of value) {
    const s = String(v).trim();
    if (!/^[0-9]+$/.test(s)) continue;
    const n = Number(s);
    if (!out.includes(n)) out.push(n);
  }
  return out;
}
