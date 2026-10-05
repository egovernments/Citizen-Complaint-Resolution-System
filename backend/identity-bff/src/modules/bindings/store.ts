import { withPersonLease } from "../accounts/person-lease.js";
import { withUuidLock } from "../accounts/uuid-lock.js";
import { paged, readUser } from "../../integrations/keycloak/admin-api.js";
import { updateKeycloakUser } from "../sync/keycloak-writer.js";
import { validateBinding } from "../workspace-members/authority.js";
import { BindingConflictError, BindingError, type Binding, type BindingActor, type BindingUser } from "./types.js";

export { BindingConflictError } from "./types.js";
export type { Binding, BindingActor } from "./types.js";

/** Invalid durable state must fail closed rather than free somebody's uuid. */
export function bindingsFromUser(user: BindingUser): Binding[] {
  const raw = user.attributes?.["digit.bindings"];
  if (!raw?.length) return [];
  try {
    const doc = JSON.parse(raw[0]);
    if (raw.length !== 1 || doc.v !== 1 || !Array.isArray(doc.bindings) || doc.bindings.length > 64) throw new Error();
    const seen = new Set<string>();
    for (const b of doc.bindings) {
      if (!b || typeof b.tenantId !== "string" || typeof b.uuid !== "string" ||
          !["pending", "active", "removed"].includes(b.state) || seen.has(b.tenantId) ||
          !Number.isInteger(b.invitationVersion) || b.invitationVersion < 1 ||
          (b.state === "pending" && !Number.isFinite(b.expiresAt))) throw new Error();
      seen.add(b.tenantId);
    }
    return doc.bindings;
  } catch {
    throw new BindingError("IDENTITY_UNAVAILABLE", "The stored bindings are invalid");
  }
}

export const readBindingUser = (subject: string): Promise<BindingUser> => readUser(subject);

export function effectiveBinding(binding: Binding, now = Date.now()): Binding {
  return binding.state === "pending" && binding.expiresAt! <= now
    ? { ...binding, state: "removed", removedAt: binding.expiresAt, removedBy: { kind: "expiry" } }
    : binding;
}

async function writeBinding(subject: string, binding: Binding): Promise<void> {
  await updateKeycloakUser(subject, (user) => {
    const records = bindingsFromUser(user);
    const index = records.findIndex((b) => b.tenantId === binding.tenantId);
    if (index < 0) records.push(binding); else records[index] = binding;
    if (records.length > 64) throw new BindingError("IDENTITY_UNAVAILABLE", "The binding limit was reached");
    return { ...user, attributes: {
      ...user.attributes,
      "digit.bindings": [JSON.stringify({ v: 1, bindings: records })],
      "digit.boundUuids": records.filter((b) => effectiveBinding(b).state !== "removed")
        .map((b) => `${b.tenantId}|${b.uuid}`).sort(),
      "digit.bindingTenants": bindingTenants(records),
    } };
  });
}

const bindingTenants = (records: Binding[]) => records.map((b) => b.tenantId).sort();

const indexed = (user: BindingUser) =>
  bindingTenants(bindingsFromUser(user)).join() === [...user.attributes?.["digit.bindingTenants"] ?? []].sort().join();

/** Backfills the tenant index for records written before it existed. Caller holds the person lease. */
export async function indexBindingTenants(subject: string): Promise<void> {
  await updateKeycloakUser(subject, (user) => indexed(user) ? null
    : { ...user, attributes: { ...user.attributes, "digit.bindingTenants": bindingTenants(bindingsFromUser(user)) } });
}

/** Expiry is a durable transition, serialized with acceptance and re-invite. */
export async function readBindings(subject: string): Promise<Binding[]> {
  const records = bindingsFromUser(await readBindingUser(subject));
  if (!records.some((b) => b.state === "pending" && b.expiresAt! <= Date.now())) return records;
  return withPersonLease(subject, async (lease) => {
    const fresh = bindingsFromUser(await readBindingUser(subject));
    for (const b of fresh) {
      if (effectiveBinding(b).state === b.state) continue;
      await withUuidLock(b.tenantId, b.uuid, async (lock) => {
        await lease.assertHeld();
        await lock.assertHeld();
        await writeBinding(subject, effectiveBinding(b));
      });
    }
    return bindingsFromUser(await readBindingUser(subject)).map((b) => effectiveBinding(b));
  });
}

/** Exact uuid search, with full pagination and client-side attribute checks. */
async function ownersOf(tenantId: string, uuid: string): Promise<string[]> {
  const value = `${tenantId}|${uuid}`;
  const query = new URLSearchParams({ q: `digit.boundUuids:${value}`, briefRepresentation: "false" });
  return (await paged<BindingUser>(`/users?${query}`)).flatMap((user) =>
    user.id && user.attributes?.["digit.boundUuids"]?.includes(value) &&
    bindingsFromUser(user).some((b) => b.tenantId === tenantId && b.uuid === uuid && effectiveBinding(b).state !== "removed")
      ? [user.id] : []);
}

/**
 * Read-only tenant inventory from the fetched Keycloak user snapshots.
 * Expired indexed invitations are excluded by their effective removed state;
 * readers must not acquire another person's lease merely to expire them.
 * This infrequent administrative read costs O(realm users): Keycloak exact q
 * cannot search a tenant prefix. Pages contain 100 users, processed serially.
 */
export async function bindingsFor(tenantId: string): Promise<Array<{ subject: string; binding: Binding }>> {
  const result: Array<{ subject: string; binding: Binding }> = [];
  // Keycloak q matches attribute values exactly; a tenant is a prefix, not a value.
  for (const user of await paged<BindingUser>("/users?briefRepresentation=false")) {
    if (!user.id || !user.attributes?.["digit.boundUuids"]?.some((v) => v.startsWith(`${tenantId}|`))) continue;
    for (const binding of bindingsFromUser(user).map((b) => effectiveBinding(b))) {
      if (binding.tenantId === tenantId && binding.state !== "removed") result.push({ subject: user.id, binding });
    }
  }
  return result;
}

type BindingInput = { subject: string; tenantId: string; uuid: string; actor: BindingActor; email?: string };

async function create(input: BindingInput, pending?: { expiresAt: number; reinvite?: boolean }): Promise<{ binding: Binding; created: boolean }> {
  return withPersonLease(input.subject, async (lease) => withUuidLock(input.tenantId, input.uuid, async (lock) => {
    await validateBinding(input);
    const previous = bindingsFromUser(await readBindingUser(input.subject)).find((b) => b.tenantId === input.tenantId);
    const old = previous && effectiveBinding(previous);
    // A removed key no longer owns its old uuid: an explicit re-invite may name the person's new
    // DIGIT record. Without reinvite, a removed key still answers BINDING_REMOVED / BINDING_CONFLICT.
    const reinviteRemoved = old?.state === "removed" && pending?.reinvite === true;
    if (old && old.uuid !== input.uuid && !reinviteRemoved) throw new BindingConflictError();
    if (old?.state === "active") return { binding: old, created: false };
    if (old?.state === "removed" && !pending?.reinvite) throw new BindingError("BINDING_REMOVED", "This binding was removed");
    if (old?.state === "pending" && !pending?.reinvite) {
      // An ensure must never implicitly accept an existing invitation.
      if (!pending) throw new BindingError("PENDING_INVITATION", "Accept the invitation first");
      return { binding: old, created: false };
    }
    if ((await ownersOf(input.tenantId, input.uuid)).some((sub) => sub !== input.subject)) {
      throw new BindingError("DIGIT_ACCOUNT_LINKED_ELSEWHERE", "The account belongs to another person");
    }
    const now = Date.now();
    const binding: Binding = {
      tenantId: input.tenantId, uuid: input.uuid, ...(input.email && { email: input.email }), state: pending ? "pending" : "active",
      invitationVersion: old ? old.invitationVersion + 1 : 1, createdAt: now,
      createdBy: input.actor.kind === "migration" ? { kind: "conversion" } : input.actor,
      ...(pending ? { expiresAt: pending.expiresAt } : { boundAt: now }),
    };
    await lease.assertHeld();
    await lock.assertHeld();
    await writeBinding(input.subject, binding);
    return { binding, created: true };
  }));
}

export function ensureActive(input: BindingInput) { return create(input); }

export function createPending(input: BindingInput & { expiresAt: number; reinvite?: boolean }) {
  if (!Number.isSafeInteger(input.expiresAt) || input.expiresAt <= Date.now()) {
    throw new BindingError("INVALID_REQUEST", "The invitation expiry must be in the future");
  }
  return create(input, input);
}

export async function accept(input: { subject: string; tenantId: string; invitationVersion: number }): Promise<Binding> {
  return withPersonLease(input.subject, async (lease) => {
    const existing = (await readBindings(input.subject)).find((b) => b.tenantId === input.tenantId);
    if (!existing || existing.state === "removed" || existing.invitationVersion !== input.invitationVersion) {
      throw new BindingError("INVITATION_STALE", "The invitation is no longer current");
    }
    return withUuidLock(existing.tenantId, existing.uuid, async (lock) => {
      const record = bindingsFromUser(await readBindingUser(input.subject)).find((b) => b.tenantId === input.tenantId);
      const current = record && effectiveBinding(record);
      if (!current || current.uuid !== existing.uuid || current.state === "removed" || current.invitationVersion !== input.invitationVersion) {
        throw new BindingError("INVITATION_STALE", "The invitation is no longer current");
      }
      if (current.state === "active") return current;
      if ((await ownersOf(current.tenantId, current.uuid)).some((sub) => sub !== input.subject)) {
        throw new BindingError("INVITATION_STALE", "The invitation no longer owns the account");
      }
      if (effectiveBinding(current).state !== "pending") throw new BindingError("INVITATION_STALE", "The invitation expired");
      const { expiresAt: _expiry, ...rest } = current;
      const binding: Binding = { ...rest, state: "active", acceptedAt: Date.now(), boundAt: Date.now() };
      await lease.assertHeld();
      await lock.assertHeld();
      await writeBinding(input.subject, binding);
      return binding;
    });
  });
}

export async function remove(input: { subject: string; tenantId: string; uuid: string; removedBy: NonNullable<Binding["removedBy"]> }): Promise<{ removed: boolean; binding?: Binding }> {
  return withPersonLease(input.subject, async (lease) => withUuidLock(input.tenantId, input.uuid, async (lock) => {
    const old = bindingsFromUser(await readBindingUser(input.subject)).find((b) => b.tenantId === input.tenantId && b.uuid === input.uuid);
    if (!old || old.state === "removed") return { removed: false, binding: old };
    const binding: Binding = { ...old, state: "removed", removedAt: Date.now(), removedBy: input.removedBy };
    await lease.assertHeld();
    await lock.assertHeld();
    await writeBinding(input.subject, binding);
    return { removed: true, binding };
  }));
}
