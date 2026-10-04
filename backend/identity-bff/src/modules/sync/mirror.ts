import { createHash } from "node:crypto";
import { config } from "../../infrastructure/config.js";
import { getRedis } from "../../infrastructure/redis.js";
import { withPersonLease, LeaseLostError, type PersonLease } from "../accounts/person-lease.js";
import { request } from "../organizations/organization-service.js";
import type { DigitAccount } from "../managed-accounts/digit-user-client.js";
import { updateKeycloakUser, type UserRepresentation } from "./keycloak-writer.js";
import { accountEntries, activeBindings, canonical, type AccountEntry } from "./state.js";
import { readDigitAccount } from "./digit-reader.js";

export interface MirrorHint { credential?: { tenantId: string; keyVersion: number; setAt: number } }
export interface MirrorSnapshot {
  user: UserRepresentation;
  previous: AccountEntry[];
  entries: AccountEntry[];
  observations: Array<{ entry: AccountEntry; account: DigitAccount | null }>;
  name?: string;
  fingerprint: string;
}
const fingerprintKey = (subject: string) => `${config.cachePrefix}:identity:mirror-fp:${subject}`;
const masked = (value: string) => /\*{2,}/.test(value);

/** Caller holds the lease. Only bindings and already-resolved citizens seed entries. */
export async function readMirrorSnapshot(subject: string, hint: MirrorHint = {}): Promise<MirrorSnapshot> {
  const user = await (await request(`/users/${encodeURIComponent(subject)}`)).json() as UserRepresentation;
  const previous = accountEntries(user);
  const candidates: AccountEntry[] = activeBindings(user).map(binding => {
    const existing = previous.find(entry => entry.kind === "staff" && entry.tenantId === binding.tenantId && entry.uuid === binding.uuid);
    return { ...(existing ?? {}), kind: "staff", tenantId: binding.tenantId, uuid: binding.uuid,
      boundAt: existing?.boundAt ?? binding.boundAt!, active: existing?.active ?? false, roles: existing?.roles ?? [] };
  });
  candidates.push(...previous.filter(entry => entry.kind === "citizen"));
  if (candidates.length > 64) throw new Error("Too many mirrored accounts");
  const observations: MirrorSnapshot["observations"] = [];
  for (const candidate of candidates) {
    const account = await readDigitAccount(candidate);
    const entry: AccountEntry = { ...candidate };
    if (!account) {
      entry.missing = true;
      entry.active = false;
    } else {
      delete entry.missing;
      entry.active = account.active;
      entry.roles = [...new Map(account.roles.map(role => [
        `${role.code}|${role.tenantId}`, { code: role.code, tenantId: role.tenantId },
      ])).values()]
        .sort((a, b) => `${a.code}|${a.tenantId}`.localeCompare(`${b.code}|${b.tenantId}`));
      if (!masked(account.userName)) entry.userName = account.userName;
    }
    if (entry.kind === "staff" && hint.credential?.tenantId === entry.tenantId) {
      const { keyVersion, setAt } = hint.credential;
      entry.credential = { keyVersion, setAt };
    }
    observations.push({ entry, account });
  }
  observations.sort((a, b) => a.entry.boundAt - b.entry.boundAt || a.entry.tenantId.localeCompare(b.entry.tenantId));
  const primary = observations.find(item => item.entry.kind === "staff" && item.entry.active && !item.entry.missing)
    ?? observations.find(item => item.entry.kind === "citizen");
  const sourceName = primary?.account?.name?.trim();
  // A national mobile fallback is useful in DIGIT, but is not a real profile name.
  const name = sourceName && !masked(sourceName) &&
    !(primary?.entry.kind === "citizen" && /^\+?[\d\s()-]+$/.test(sourceName)) ? sourceName : undefined;
  const entries = observations.map(item => item.entry);
  const fingerprint = createHash("sha256").update(canonical({ entries, name,
    modified: observations.map(item => (item.account as (DigitAccount & {lastModifiedDate?: unknown}) | null)?.lastModifiedDate),
  })).digest("hex");
  return { user, previous, entries, observations, name, fingerprint };
}

/** Fingerprints optimize mirror writes only; callers still perform all access/revocation checks. */
export async function applyMirrorSnapshot(subject: string, snapshot: MirrorSnapshot, lease: PersonLease,
  force = false): Promise<boolean> {
  const matches = canonical(snapshot.previous) === canonical(snapshot.entries) &&
    (snapshot.name === undefined || (snapshot.user.firstName === snapshot.name && !snapshot.user.lastName));
  if (!force && matches && await getRedis().get(fingerprintKey(subject)) === snapshot.fingerprint) return false;
  let wrote = false;
  await updateKeycloakUser(subject, current => {
    const sameEntries = canonical(accountEntries(current)) === canonical(snapshot.entries);
    const sameName = snapshot.name === undefined || (current.firstName === snapshot.name && !current.lastName);
    if (sameEntries && sameName) return null;
    wrote = true;
    return { ...current, attributes: { ...current.attributes,
      "digit.accounts": [JSON.stringify({ v: 1, mirroredAt: Date.now(), entries: snapshot.entries })] },
      ...(snapshot.name === undefined ? {} : { firstName: snapshot.name, lastName: "" }) };
  });
  if (!await lease.fencedSet(fingerprintKey(subject), snapshot.fingerprint, Date.now() + 7 * 86400_000)) {
    throw new LeaseLostError();
  }
  return wrote;
}

/** Immediate mirror for binding transitions and credential updates. No membership/binding writes. */
export function mirrorPerson(subject: string, hint?: MirrorHint): Promise<void> {
  return withPersonLease(subject, async lease => {
    await lease.assertHeld();
    const snapshot = await readMirrorSnapshot(subject, hint);
    await applyMirrorSnapshot(subject, snapshot, lease);
  });
}
