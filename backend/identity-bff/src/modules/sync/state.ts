import type { UserRepresentation } from "./keycloak-writer.js";
import { bindingsFromUser } from "../bindings/store.js";
import type { Binding } from "../bindings/types.js";
export type { Binding } from "../bindings/types.js";

export interface AccountEntry {
  kind: "staff" | "citizen";
  tenantId: string;
  uuid: string;
  boundAt: number;
  active: boolean;
  roles: Array<{ code: string; tenantId: string }>;
  userName?: string;
  missing?: true;
  credential?: { keyVersion: number; setAt?: number };
}

function document(user: UserRepresentation, attribute: string): Record<string, unknown> | null {
  const values = user.attributes?.[attribute];
  if (!values?.length) return null;
  if (values.length !== 1) throw new Error(`Invalid ${attribute} document`);
  const value = JSON.parse(values[0]);
  if (!value || value.v !== 1) throw new Error(`Unsupported ${attribute} version`);
  return value;
}

/** Fail closed on malformed state rather than silently replacing it. */
export function accountEntries(user: UserRepresentation): AccountEntry[] {
  const value = document(user, "digit.accounts");
  if (!value) return [];
  if (!Array.isArray(value.entries) || value.entries.length > 64) throw new Error("Invalid digit.accounts entries");
  const seen = new Set<string>();
  for (const entry of value.entries) {
    if (!entry || !["staff", "citizen"].includes(entry.kind) || typeof entry.tenantId !== "string" ||
        typeof entry.uuid !== "string" || !Number.isSafeInteger(entry.boundAt) || entry.boundAt < 0 ||
        typeof entry.active !== "boolean" || !Array.isArray(entry.roles) ||
        entry.roles.some((role: { code?: unknown; tenantId?: unknown }) =>
          !role || typeof role.code !== "string" || typeof role.tenantId !== "string")) {
      throw new Error("Invalid digit.accounts entry");
    }
    const key = `${entry.kind}:${entry.tenantId}`;
    if (seen.has(key)) throw new Error("Duplicate digit.accounts entry");
    seen.add(key);
  }
  return value.entries;
}

export function activeBindings(user: UserRepresentation): Binding[] {
  return bindingsFromUser(user).filter(binding => binding.state === "active");
}

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value)
    .filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
