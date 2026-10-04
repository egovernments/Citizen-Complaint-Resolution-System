import { normalizeOrganizationPayload, organizationOperationHash, type OrganizationEnsurePayload } from "../control-plane/operation-hash.js";
import { OnboardingError } from "./errors.js";
import { withOnboardingLock, type OnboardingFence } from "./locks.js";

export interface OnboardingOrganization {
  id: string;
  alias: string;
  name: string;
  enabled?: boolean;
  attributes?: Record<string, string[]>;
}
export interface Attempt { operationId: string; restartNo: number }
export interface FounderAttempt extends Attempt { subject: string; tenantId: string }
export interface OnboardingDependencies {
  organizations(): Promise<OnboardingOrganization[]>;
  create(organization: Omit<OnboardingOrganization, "id">): Promise<OnboardingOrganization>;
  update(organization: OnboardingOrganization): Promise<void>;
  tenantExists(tenantId: string): Promise<boolean>;
  identityExists(subject: string): Promise<boolean>;
  membership(organizationId: string, subject: string, fence: OnboardingFence): Promise<void>;
  binding(input: FounderAttempt & { digitUuid: string }, fence: OnboardingFence): Promise<unknown>;
  revoke(tenantId: string): Promise<void>;
  invalidate(): void;
}

export const organizationAttribute = (org: OnboardingOrganization, name: string): string | undefined =>
  org.attributes?.[`digit.${name}`]?.[0];
const tenantOf = (org: OnboardingOrganization) => organizationAttribute(org, "rootTenantId") ?? "";
const restartOf = (org: OnboardingOrganization) => Number(organizationAttribute(org, "restartNo"));
const lifecycleOf = (org: OnboardingOrganization) => organizationAttribute(org, "lifecycle") ?? "ACTIVE";
const operationOf = (org: OnboardingOrganization) => organizationAttribute(org, "operationId");
const slugOf = (org: OnboardingOrganization) => organizationAttribute(org, "urlSlug") ?? org.alias;
function failedName(org: OnboardingOrganization): string {
  const suffix = ` [failed ${org.id.slice(0, 8)}]`;
  return org.name.endsWith(suffix) ? org.name : `${org.name}${suffix}`;
}

function view(org: OnboardingOrganization) {
  return { id: org.id, alias: org.alias, urlSlug: slugOf(org), tenantId: tenantOf(org),
    name: org.name, lifecycle: lifecycleOf(org), operationId: operationOf(org), restartNo: restartOf(org) };
}

export interface ReplacementPending extends OrganizationEnsurePayload { restartNo: number; operationHash: string }

export function replacementPending(org: OnboardingOrganization): ReplacementPending | undefined {
  const values = org.attributes?.["digit.replacementPending"];
  if (values === undefined) return undefined;
  try {
    if (values.length !== 1) throw new Error();
    const pending = JSON.parse(values[0]) as ReplacementPending;
    if (!pending || !Number.isSafeInteger(restartOf(org)) || !Number.isSafeInteger(pending.restartNo) || pending.restartNo <= restartOf(org) ||
        typeof pending.tenantId !== "string" || !pending.tenantId ||
        typeof pending.slug !== "string" || !pending.slug || typeof pending.name !== "string" || !pending.name ||
        pending.operationHash !== organizationOperationHash(pending)) throw new Error();
    const normalized = normalizeOrganizationPayload(pending);
    if (normalized.tenantId !== pending.tenantId || normalized.slug !== pending.slug || normalized.name !== pending.name) throw new Error();
    return pending;
  } catch {
    throw new OnboardingError("IDENTITY_UNAVAILABLE", "The pending replacement is invalid");
  }
}

/** Shared with raw readers: actual records and the durable in-flight attempt form one authority. */
export function operationAuthority(organizations: OnboardingOrganization[], operationId: string) {
  const owned = organizations.filter((org) => operationOf(org) === operationId);
  const restarts = new Set<number>();
  const pendingRecords: Array<{ owner: OnboardingOrganization; value: ReplacementPending }> = [];
  for (const org of owned) {
    const restart = organizationAttribute(org, "restartNo");
    if (!restart || !/^(0|[1-9]\d*)$/.test(restart) || !Number.isSafeInteger(Number(restart)) ||
        org.attributes?.["digit.restartNo"]?.length !== 1 ||
        org.attributes?.["digit.operationId"]?.length !== 1 ||
        !/^[a-f0-9]{64}$/.test(organizationAttribute(org, "operationHash") ?? "") ||
        !["PROVISIONING", "ACTIVE", "FAILED"].includes(organizationAttribute(org, "lifecycle") ?? "") ||
        !org.id || !tenantOf(org) || !slugOf(org) || restarts.has(Number(restart))) {
      throw new OnboardingError("IDENTITY_UNAVAILABLE", "The onboarding attempt authority is invalid or ambiguous");
    }
    restarts.add(Number(restart));
    const pending = replacementPending(org);
    if (pending) pendingRecords.push({ owner: org, value: pending });
  }
  if (pendingRecords.length > 1) throw new OnboardingError("IDENTITY_UNAVAILABLE", "Multiple replacements are pending for the operation");
  const org = owned.sort((a, b) => restartOf(b) - restartOf(a))[0];
  const pending = pendingRecords[0];
  if (pending && org && pending.value.restartNo <= restartOf(org)) {
    const replacement = owned.find((candidate) => restartOf(candidate) === pending.value.restartNo);
    if (!replacement || organizationAttribute(replacement, "operationHash") !== pending.value.operationHash ||
        tenantOf(replacement) !== pending.value.tenantId || slugOf(replacement) !== pending.value.slug) {
      throw new OnboardingError("IDENTITY_UNAVAILABLE", "The pending replacement does not match its Organization");
    }
  }
  return { org, pending, restartNo: Math.max(org ? restartOf(org) : -1, pending?.value.restartNo ?? -1) };
}

function requireAttempt(authority: ReturnType<typeof operationAuthority>, attempt: Attempt) {
  const { org } = authority;
  if (attempt.restartNo < authority.restartNo) {
    throw new OnboardingError("ATTEMPT_STALE", "A newer onboarding attempt exists");
  }
  if (!org || attempt.restartNo > restartOf(org)) {
    throw new OnboardingError("OPERATION_NOT_FOUND", "Ensure the Organization for this attempt first");
  }
  return org;
}

export class OnboardingPrimitives {
  constructor(private readonly dependencies: OnboardingDependencies) {}

  ensure(input: Attempt & OrganizationEnsurePayload) {
    const payload = normalizeOrganizationPayload(input);
    const hash = organizationOperationHash(payload);
    return withOnboardingLock("op", input.operationId, async (operationFence) => {
      const initial = await this.dependencies.organizations();
      const authority = operationAuthority(initial, input.operationId);
      const previous = authority.org;
      if (input.restartNo < authority.restartNo) {
        throw new OnboardingError("ATTEMPT_STALE", "A newer onboarding attempt exists");
      }
      // Lock both old and new identifiers in deterministic order when a restart changes them.
      const tenants = [...new Set([payload.tenantId, ...(previous ? [tenantOf(previous)] : []), ...(authority.pending ? [authority.pending.value.tenantId] : [])])].sort();
      const slugs = [...new Set([payload.slug, ...(previous ? [slugOf(previous)] : []), ...(authority.pending ? [authority.pending.value.slug] : [])])].sort();
      const locks = [...tenants.map((id) => ({ family: "tenant" as const, id })),
        ...slugs.map((id) => ({ family: "slug" as const, id }))];
      const run = (index: number, fence: OnboardingFence): Promise<{ organization: ReturnType<typeof view>; created: boolean }> => {
        if (index < locks.length) {
          const lock = locks[index];
          return withOnboardingLock(lock.family, lock.id, (child) => run(index + 1, child), fence);
        }
        return this.ensureLocked(input, payload, hash, fence);
      };
      return run(0, operationFence);
    });
  }

  private async ensureLocked(input: Attempt, payload: OrganizationEnsurePayload, hash: string, fence: OnboardingFence) {
    const organizations = await this.dependencies.organizations();
    const authority = operationAuthority(organizations, input.operationId);
    const previous = authority.org;
    if (input.restartNo < authority.restartNo) throw new OnboardingError("ATTEMPT_STALE", "A newer onboarding attempt exists");
    if (authority.pending?.value.restartNo === input.restartNo && authority.pending.value.operationHash !== hash) {
      throw new OnboardingError("OPERATION_CONFLICT", "The pending attempt payload has changed");
    }
    if (authority.pending?.value.restartNo === input.restartNo && previous && input.restartNo > restartOf(previous) &&
        lifecycleOf(authority.pending.owner) === "FAILED" &&
        organizationAttribute(authority.pending.owner, "lifecycleRestartNo") === String(input.restartNo)) {
      throw new OnboardingError("LIFECYCLE_CONFLICT", "The pending attempt has failed; advance restartNo before ensuring again");
    }
    if (previous && input.restartNo === restartOf(previous)) {
      if (organizationAttribute(previous, "operationHash") !== hash) {
        throw new OnboardingError("OPERATION_CONFLICT", "The attempt payload has changed");
      }
      await this.supersedeOlder(organizations, previous, fence);
      return { organization: view(previous), created: false };
    }
    if (previous && (lifecycleOf(previous) === "ACTIVE" || previous.enabled === false)) {
      throw new OnboardingError("LIFECYCLE_CONFLICT", "An active or disabled Organization cannot be reopened");
    }
    for (const org of organizations) {
      if (operationOf(org) === input.operationId) continue;
      const pending = replacementPending(org);
      if (tenantOf(org) === payload.tenantId || pending?.tenantId === payload.tenantId) throw new OnboardingError("TENANT_TAKEN", "The tenant belongs to another operation");
      if (slugOf(org) === payload.slug || org.alias === payload.slug || pending?.slug === payload.slug) throw new OnboardingError("SLUG_TAKEN", "The slug belongs to another operation");
    }
    if (!await this.dependencies.tenantExists(payload.tenantId)) {
      throw new OnboardingError("TENANT_FOUNDATION_MISSING", "The DIGIT tenant foundation does not exist yet");
    }
    const attributes: Record<string, string[]> = {
      ...(previous?.attributes ?? {}),
      "digit.rootTenantId": [payload.tenantId], "digit.urlSlug": [payload.slug],
      "digit.operationId": [input.operationId], "digit.restartNo": [String(input.restartNo)],
      "digit.operationHash": [hash], "digit.lifecycle": ["PROVISIONING"],
      "digit.lifecycleRestartNo": [String(input.restartNo)],
    };
    delete attributes["digit.supersededBy"];
    delete attributes["digit.replacementPending"];
    const changedSlug = previous && slugOf(previous) !== payload.slug;
    // Keycloak enforces unique Organization names. Free the name before create;
    // an interrupted create is resumed from this still-owned FAILED record.
    if (changedSlug) {
      // Finish an already-created replacement's old marker before staging its next restart.
      if (authority.pending && authority.pending.value.restartNo <= restartOf(previous)) {
        await this.supersedeOlder(organizations, previous, fence);
      }
      const pending: ReplacementPending = { ...payload, restartNo: input.restartNo, operationHash: hash };
      const staged = { ...previous, attributes: { ...previous.attributes, "digit.replacementPending": [JSON.stringify(pending)] } };
      await fence.assertHeld();
      await this.dependencies.update(staged);
      await fence.assertHeld();
      await this.dependencies.update({ ...previous,
        name: failedName(previous),
        attributes: { ...staged.attributes, "digit.lifecycle": ["FAILED"], "digit.lifecycleRestartNo": [String(restartOf(previous))] } });
      this.dependencies.invalidate();
      await fence.assertHeld();
      await this.dependencies.revoke(tenantOf(previous));
    }
    await fence.assertHeld();
    let org: OnboardingOrganization;
    const created = !previous || Boolean(changedSlug);
    if (created) {
      org = await this.dependencies.create({ name: payload.name, alias: payload.slug, enabled: true, attributes });
    } else {
      org = { ...previous!, name: payload.name, attributes };
      await this.dependencies.update(org);
    }
    this.dependencies.invalidate();
    await this.supersedeOlder(organizations, org, fence);
    return { organization: view(org), created };
  }

  private async supersedeOlder(organizations: OnboardingOrganization[], latest: OnboardingOrganization, fence: OnboardingFence) {
    for (const org of organizations) {
      if (org.id === latest.id || operationOf(org) !== operationOf(latest)) continue;
      if (organizationAttribute(org, "supersededBy") === latest.id && lifecycleOf(org) === "FAILED" && !org.attributes?.["digit.replacementPending"]) continue;
      const attributes: Record<string, string[]> = { ...org.attributes, "digit.lifecycle": ["FAILED"], "digit.lifecycleRestartNo": [String(restartOf(org))], "digit.supersededBy": [latest.id] };
      delete attributes["digit.replacementPending"];
      await fence.assertHeld();
      await this.dependencies.update({ ...org,
        name: failedName(org),
        attributes });
      this.dependencies.invalidate();
    }
  }

  lifecycle(input: Attempt & { state: "ACTIVE" | "FAILED" }) {
    return withOnboardingLock("op", input.operationId, async (fence) => {
      const authority = operationAuthority(await this.dependencies.organizations(), input.operationId);
      // A replacement can fail permanently after staging but before create.
      // Record that terminal decision on its staging record without inventing
      // an Organization for the pending restart or dropping its high-water mark.
      const pendingFailure = input.state === "FAILED" && authority.pending &&
        authority.restartNo === input.restartNo && input.restartNo > restartOf(authority.org!) &&
        authority.pending.value.restartNo === input.restartNo;
      const org = pendingFailure ? authority.pending!.owner : requireAttempt(authority, input);
      const lifecycle = lifecycleOf(org);
      if (lifecycle !== "PROVISIONING" && lifecycle !== input.state) {
        throw new OnboardingError("LIFECYCLE_CONFLICT", "The lifecycle decision cannot change");
      }
      if (lifecycle !== input.state || organizationAttribute(org, "lifecycleRestartNo") !== String(input.restartNo)) {
        await fence.assertHeld();
        org.attributes = { ...org.attributes, "digit.lifecycle": [input.state], "digit.lifecycleRestartNo": [String(input.restartNo)] };
        await this.dependencies.update(org);
        this.dependencies.invalidate();
      }
      if (input.state === "FAILED") {
        // Repeat fan-out even when the state already matches: an earlier call
        // may have died after the Organization write but before publication.
        await fence.assertHeld();
        await this.dependencies.revoke(tenantOf(org));
      }
      return { organization: { id: org.id, tenantId: tenantOf(org), lifecycle: input.state, restartNo: input.restartNo } };
    });
  }

  private founder<T>(input: FounderAttempt, apply: (org: OnboardingOrganization, fence: OnboardingFence) => Promise<T>) {
    return withOnboardingLock("op", input.operationId, async (fence) => {
      const org = requireAttempt(operationAuthority(await this.dependencies.organizations(), input.operationId), input);
      if (tenantOf(org) !== input.tenantId) throw new OnboardingError("OPERATION_NOT_FOUND", "The operation does not own this tenant");
      if (!await this.dependencies.identityExists(input.subject)) throw new OnboardingError("IDENTITY_NOT_FOUND", "The founder identity was not found");
      await fence.assertHeld();
      return apply(org, fence);
    });
  }

  membership(input: FounderAttempt) {
    return this.founder(input, async (org, fence) => {
      await this.dependencies.membership(org.id, input.subject, fence);
      return { tenantId: input.tenantId, subject: input.subject, member: true as const };
    });
  }

  binding(input: FounderAttempt & { digitUuid: string }) {
    return this.founder(input, (_org, fence) => this.dependencies.binding(input, fence));
  }
}
