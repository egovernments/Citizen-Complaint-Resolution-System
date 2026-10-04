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

function view(org: OnboardingOrganization) {
  return { id: org.id, alias: org.alias, urlSlug: slugOf(org), tenantId: tenantOf(org),
    name: org.name, lifecycle: lifecycleOf(org), operationId: operationOf(org), restartNo: restartOf(org) };
}

function current(organizations: OnboardingOrganization[], attempt: Attempt) {
  return organizations.filter((org) => operationOf(org) === attempt.operationId)
    .sort((a, b) => restartOf(b) - restartOf(a))[0];
}

function requireAttempt(org: OnboardingOrganization | undefined, attempt: Attempt) {
  if (org && attempt.restartNo < restartOf(org)) {
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
      const previous = current(initial, input);
      if (previous && input.restartNo < restartOf(previous)) {
        throw new OnboardingError("ATTEMPT_STALE", "A newer onboarding attempt exists");
      }
      // Lock both old and new identifiers in deterministic order when a restart changes them.
      const tenants = [...new Set([payload.tenantId, ...(previous ? [tenantOf(previous)] : [])])].sort();
      const slugs = [...new Set([payload.slug, ...(previous ? [slugOf(previous)] : [])])].sort();
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
    const previous = current(organizations, input);
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
      if (tenantOf(org) === payload.tenantId) throw new OnboardingError("TENANT_TAKEN", "The tenant belongs to another operation");
      if (slugOf(org) === payload.slug || org.alias === payload.slug) throw new OnboardingError("SLUG_TAKEN", "The slug belongs to another operation");
    }
    if (!await this.dependencies.tenantExists(payload.tenantId)) {
      throw new OnboardingError("TENANT_FOUNDATION_MISSING", "The DIGIT tenant foundation does not exist yet");
    }
    const attributes: Record<string, string[]> = {
      ...(previous?.attributes ?? {}),
      "digit.rootTenantId": [payload.tenantId], "digit.urlSlug": [payload.slug],
      "digit.operationId": [input.operationId], "digit.restartNo": [String(input.restartNo)],
      "digit.operationHash": [hash], "digit.lifecycle": ["PROVISIONING"],
    };
    delete attributes["digit.supersededBy"];
    const changedSlug = previous && slugOf(previous) !== payload.slug;
    // Keycloak enforces unique Organization names. Free the name before create;
    // an interrupted create is resumed from this still-owned FAILED record.
    if (changedSlug) {
      await fence.assertHeld();
      await this.dependencies.update({ ...previous,
        name: `${previous.name.split(" [superseded:")[0]} [superseded:${previous.id}]`,
        attributes: { ...previous.attributes, "digit.lifecycle": ["FAILED"] } });
      this.dependencies.invalidate();
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
      if (organizationAttribute(org, "supersededBy") === latest.id && lifecycleOf(org) === "FAILED") continue;
      await fence.assertHeld();
      await this.dependencies.update({ ...org,
        name: `${org.name.split(" [superseded:")[0]} [superseded:${org.id}]`,
        attributes: { ...org.attributes, "digit.lifecycle": ["FAILED"], "digit.supersededBy": [latest.id] } });
      this.dependencies.invalidate();
    }
  }

  lifecycle(input: Attempt & { state: "ACTIVE" | "FAILED" }) {
    return withOnboardingLock("op", input.operationId, async (fence) => {
      const org = requireAttempt(current(await this.dependencies.organizations(), input), input);
      const lifecycle = lifecycleOf(org);
      if (lifecycle !== "PROVISIONING" && lifecycle !== input.state) {
        throw new OnboardingError("LIFECYCLE_CONFLICT", "The lifecycle decision cannot change");
      }
      if (lifecycle !== input.state) {
        await fence.assertHeld();
        org.attributes = { ...org.attributes, "digit.lifecycle": [input.state] };
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
      const org = requireAttempt(current(await this.dependencies.organizations(), input), input);
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
