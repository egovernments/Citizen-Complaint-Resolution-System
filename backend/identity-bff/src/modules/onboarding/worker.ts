import { hostname } from "node:os";
import { config } from "../../infrastructure/config.js";
import { digitProvisionerConfigured } from "../managed-accounts/digit-admin-session.js";
import { DigitUnavailableError } from "../managed-accounts/digit-user-client.js";
import {
  ensureOrganization,
  ensureOrganizationMembership,
  ensureOrganizationRoleAssignment,
  IdentityAdminError,
} from "../organizations/organization-service.js";
import { syncSubject } from "../reconciliation/subject-sync.js";
import { clearTenantCaches } from "../access-context/tenant-directory.js";
import { ManagedAccountError } from "../managed-accounts/managed-account-service.js";
import { ensureTenantFoundation } from "./tenant-foundation.js";

/**
 * Optional in-process worker for submitted PGR onboarding signups.
 *
 * It leases PENDING operations through PGR's workload API (never its
 * database) and provisions, idempotently:
 *   TENANT_FOUNDATION  independent root tenant schema + self-record, minimum
 *                      tenant-admin DIGIT roles, and encryption key
 *   ORGANIZATION       Keycloak Organization mapped to the tenant
 *   TENANT_ADMIN_MEMBERSHIP tenant admin added to the Organization
 *   TENANT_ADMIN_ROLES tenant-admin group with ONBOARDING_TENANT_ADMIN_ROLES
 *   DIGIT_ACCOUNT      tenant admin's BFF-managed DIGIT account at the new tenant
 * then reports success, retryable failure or terminal failure back to PGR.
 * Application schemas, masters, workflows, boundaries and localization are
 * deliberately not provisioned here. The new tenant is identity-ready but
 * otherwise empty until the management/configuration flow fills it.
 */

interface ClaimedOperation {
  Operation: { id: string; completedSteps?: string[] };
  leaseToken: string;
  Signup: {
    id: string;
    ownerIssuer: string;
    ownerSubject: string;
    accountName: string;
    accountCode: string;
    countryCode: string;
    organizationAlias: string;
    requestedTenantId: string;
    tenantMetadata?: Record<string, unknown>;
  };
}

function tenantAdminContact(signup: ClaimedOperation["Signup"]): {
  mobileNumber: string;
  countryCode?: string;
} {
  const tenantAdmin = signup.tenantMetadata?.tenantAdmin as {
    mobileNumber?: unknown;
    countryCode?: unknown;
  } | undefined;
  let mobileNumber = typeof tenantAdmin?.mobileNumber === "string"
    ? tenantAdmin.mobileNumber.replace(/[\s()-]/g, "")
    : "";
  const countryCode = typeof tenantAdmin?.countryCode === "string"
    ? tenantAdmin.countryCode.trim()
    : "";
  // egov-user stores the dial code separately and validates only national digits.
  if (countryCode && mobileNumber.startsWith(countryCode)) {
    mobileNumber = mobileNumber.slice(countryCode.length);
  }
  return { mobileNumber, ...(countryCode && { countryCode }) };
}

export class ProvisioningFailure extends Error {
  constructor(readonly code: string, message: string, readonly retryable: boolean) {
    super(message);
  }
}

const workerId = `identity-bff:${hostname()}:${process.pid}`;

async function pgr(path: string, body: unknown): Promise<Response> {
  const base = config.pgrOnboardingWorkerUrl.replace(/\/$/, "");
  return fetch(`${base}/v2/onboarding/internal/operations/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.pgrOnboardingWorkerToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(config.digitTimeoutMs),
  });
}

async function claim(): Promise<ClaimedOperation | null> {
  const response = await pgr("_claim", { workerId, leaseSeconds: config.onboardingWorkerLeaseSeconds });
  if (response.status === 204) return null;
  if (!response.ok) throw new Error(`PGR claim returned ${response.status}`);
  return await response.json() as ClaimedOperation;
}

async function settle(path: "_complete" | "_fail", body: Record<string, unknown>): Promise<void> {
  const response = await pgr(path, body);
  if (!response.ok) throw new Error(`PGR ${path} returned ${response.status}`);
}

async function createTenantFoundation(signup: ClaimedOperation["Signup"]): Promise<void> {
  if (!digitProvisionerConfigured()) {
    throw new ProvisioningFailure("TENANT_FOUNDATION_UNAVAILABLE",
      "The tenant foundation provisioner is not configured", true);
  }
  await ensureTenantFoundation(signup);
  clearTenantCaches();
}

function classify(error: unknown, step: string): ProvisioningFailure {
  if (error instanceof ProvisioningFailure) return error;
  if (error instanceof ManagedAccountError) {
    return new ProvisioningFailure("TENANT_ADMIN_ACCOUNT_REJECTED", error.message, false);
  }
  if (error instanceof IdentityAdminError && (error.status === 400 || error.status === 409)) {
    return new ProvisioningFailure(`${step}_CONFLICT`, error.message, false);
  }
  if (error instanceof DigitUnavailableError) {
    if (error.status === 400 || error.status === 409 || error.status === 422) {
      return new ProvisioningFailure("DIGIT_VALIDATION_FAILED", error.message, false);
    }
    if (error.status === 403) {
      return new ProvisioningFailure("DIGIT_FORBIDDEN", error.message, false);
    }
    return new ProvisioningFailure("DIGIT_UNAVAILABLE", error.message, true);
  }
  if (error instanceof IdentityAdminError) {
    return new ProvisioningFailure("KEYCLOAK_UNAVAILABLE", error.message, true);
  }
  return new ProvisioningFailure("PROVISIONING_ERROR", "Unexpected provisioning error", true);
}

export async function processOnboardingOperation(claimed: ClaimedOperation): Promise<"SUCCEEDED" | "FAILED"> {
  const { Signup: signup } = claimed;
  const completed = new Set(claimed.Operation.completedSteps || []);
  let step = "IDENTITY";
  const run = async (name: string, action: () => Promise<void>) => {
    step = name;
    await action();
    completed.add(name);
  };
  try {
    if (signup.ownerIssuer !== config.keycloakIssuer) {
      throw new ProvisioningFailure("IDENTITY_ISSUER_MISMATCH", "Signup owner is from another issuer", false);
    }
    let organizationId = "";
    await run("TENANT_FOUNDATION", () => createTenantFoundation(signup));
    await run("ORGANIZATION", async () => {
      organizationId = (await ensureOrganization({
        tenantId: signup.requestedTenantId, alias: signup.organizationAlias, name: signup.accountName,
        accountCode: signup.accountCode, urlSlug: signup.organizationAlias,
      })).id;
      clearTenantCaches();
    });
    await run("TENANT_ADMIN_MEMBERSHIP", () => ensureOrganizationMembership({
      organizationId, userId: signup.ownerSubject,
    }));
    await run("TENANT_ADMIN_ROLES", async () => {
      await ensureOrganizationRoleAssignment({
        organizationId, userId: signup.ownerSubject, groupName: config.onboardingTenantAdminGroup,
        clientId: config.digitRoleClientId, roles: config.onboardingTenantAdminRoles,
      });
    });
    await run("DIGIT_ACCOUNT", async () => {
      const contact = tenantAdminContact(signup);
      await syncSubject(signup.ownerSubject, contact.mobileNumber, contact.countryCode);
    });
    await settle("_complete", {
      id: claimed.Operation.id, leaseToken: claimed.leaseToken, completedSteps: [...completed],
    });
    console.log("Onboarding operation succeeded:", claimed.Operation.id);
    return "SUCCEEDED";
  } catch (error) {
    const failure = classify(error, step);
    console.warn(`Onboarding operation ${claimed.Operation.id} failed at ${step}:`, failure.code);
    await settle("_fail", {
      id: claimed.Operation.id, leaseToken: claimed.leaseToken, retryable: failure.retryable,
      errorCode: failure.code, errorMessage: failure.message, currentStep: step,
      completedSteps: [...completed],
    });
    return "FAILED";
  }
}

/** Processes available operations once. Never throws; returns how many were handled. */
export async function runOnboardingWorkerOnce(maxOperations = 10): Promise<number> {
  let handled = 0;
  try {
    while (handled < maxOperations) {
      const claimed = await claim();
      if (!claimed) break;
      handled += 1;
      await processOnboardingOperation(claimed);
    }
  } catch (error) {
    console.warn("Onboarding worker cycle stopped:", (error as Error).message);
  }
  return handled;
}

/** Starts the worker when ONBOARDING_WORKER_ENABLED=true. Returns a stop function. */
export function startOnboardingWorker(): () => void {
  if (!config.onboardingWorkerEnabled) return () => undefined;
  if (!config.pgrOnboardingWorkerUrl || !config.pgrOnboardingWorkerToken) {
    console.warn("Onboarding worker enabled but PGR_ONBOARDING_WORKER_URL/TOKEN are not set; not starting");
    return () => undefined;
  }
  let running = false;
  const tick = () => {
    if (running) return;
    running = true;
    void runOnboardingWorkerOnce().finally(() => {
      running = false;
    });
  };
  const timer = setInterval(tick, config.onboardingWorkerIntervalSeconds * 1000);
  timer.unref();
  tick();
  console.log("Onboarding worker started:", workerId);
  return () => clearInterval(timer);
}
