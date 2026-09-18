import { config } from "../../infrastructure/config.js";
import { withDigitProvisioner } from "../managed-accounts/digit-admin-session.js";
import { DigitUnauthorizedError, DigitUnavailableError } from "../managed-accounts/digit-user-client.js";
import { clearTenantCaches, isActiveDigitTenant } from "../access-context/tenant-directory.js";

export interface TenantFoundationSignup {
  requestedTenantId: string;
  accountName: string;
}

interface SchemaDefinition {
  code: string;
  description?: string;
  definition: Record<string, unknown>;
}

interface MdmsRecord {
  uniqueIdentifier?: string;
  isActive?: boolean;
  data?: Record<string, unknown>;
}

const ROLE_SCHEMA_CODE = "ACCESSCONTROL-ROLES.roles";

function requestInfo(token: string) {
  return { apiId: "digit-identity-bff", ver: "1.0", ts: Date.now(), authToken: token };
}

async function post(url: string, body: unknown, operation: string): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.digitTimeoutMs),
    });
  } catch {
    throw new DigitUnavailableError(`DIGIT ${operation} request failed`);
  }
  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel();
    throw new DigitUnauthorizedError(`DIGIT ${operation} was not authorized`);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new DigitUnavailableError(`DIGIT ${operation} returned ${response.status}`,
      response.status);
  }
  try {
    return await response.json() as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function schemaDefinition(
  token: string,
  tenantId: string,
  code: string,
): Promise<SchemaDefinition | null> {
  const body = await post(config.digitMdmsSchemaSearchUrl, {
    RequestInfo: requestInfo(token),
    SchemaDefCriteria: { tenantId, codes: [code], limit: 10 },
  }, `${code} schema search`);
  const schemas = Array.isArray(body.SchemaDefinitions)
    ? body.SchemaDefinitions as SchemaDefinition[]
    : [];
  return schemas.find((schema) => schema.code === code) || null;
}

async function ensureSchema(token: string, target: string, code: string): Promise<void> {
  if (await schemaDefinition(token, target, code)) return;
  const source = await schemaDefinition(token, config.digitFoundationSourceTenant, code);
  if (!source) {
    throw new DigitUnavailableError(
      `Foundation source ${config.digitFoundationSourceTenant} has no ${code} schema`, 409,
    );
  }
  try {
    await post(config.digitMdmsSchemaCreateUrl, {
      RequestInfo: requestInfo(token),
      SchemaDefinition: {
        tenantId: target,
        code: source.code,
        description: source.description || source.code,
        definition: source.definition,
        isActive: true,
      },
    }, `${code} schema create`);
  } catch (error) {
    if (!(error instanceof DigitUnavailableError) ||
        (error.status !== 400 && error.status !== 409) ||
        !await schemaDefinition(token, target, code)) throw error;
  }
}

async function ensureTenantSchema(token: string, target: string): Promise<void> {
  await ensureSchema(token, target, "tenant.tenants");
}

async function roleRecords(
  token: string,
  tenantId: string,
  roleCodes: string[],
): Promise<MdmsRecord[]> {
  if (!roleCodes.length) return [];
  const body = await post(config.digitMdmsV2SearchUrl, {
    RequestInfo: requestInfo(token),
    MdmsCriteria: {
      tenantId,
      schemaCode: ROLE_SCHEMA_CODE,
      limit: Math.max(roleCodes.length, 1000),
      offset: 0,
    },
  }, "role search");
  return Array.isArray(body.mdms) ? body.mdms as MdmsRecord[] : [];
}

function roleCode(record: MdmsRecord): string {
  return typeof record.data?.code === "string" ? record.data.code : "";
}

function requiredDigitRoleCodes(): string[] {
  return [...new Set([
    ...config.digitManagedBaseRoles,
    ...config.onboardingTenantAdminRoles.filter((code) =>
      config.digitManagedRoleAllowlist.includes(code)),
  ])].sort();
}

/**
 * egov-user validates every assigned role against the account tenant's own
 * ACCESSCONTROL-ROLES.roles records. Seed only the roles needed by the first
 * managed tenant-admin account; the rest of the platform baseline remains a
 * separate configuration concern.
 */
async function ensureTenantAdminRoles(token: string, target: string): Promise<void> {
  const requiredCodes = requiredDigitRoleCodes();
  await ensureSchema(token, target, ROLE_SCHEMA_CODE);

  const targetCodes = new Set((await roleRecords(token, target, requiredCodes))
    .filter((record) => record.isActive !== false)
    .map(roleCode));
  const missingCodes = requiredCodes.filter((code) => !targetCodes.has(code));
  if (!missingCodes.length) return;

  const sourceByCode = new Map((await roleRecords(
    token, config.digitFoundationSourceTenant, missingCodes,
  )).filter((record) => record.isActive !== false).map((record) => [roleCode(record), record]));
  const absentAtSource = missingCodes.filter((code) => !sourceByCode.has(code));
  if (absentAtSource.length) {
    throw new DigitUnavailableError(
      `Foundation source ${config.digitFoundationSourceTenant} has no role definitions for ${absentAtSource.join(", ")}`,
      409,
    );
  }

  for (const code of missingCodes) {
    const sourceData = sourceByCode.get(code)?.data || {};
    const data = {
      code,
      name: typeof sourceData.name === "string" ? sourceData.name : code,
      description: typeof sourceData.description === "string" ? sourceData.description : code,
    };
    try {
      await post(`${config.digitMdmsCreateUrl.replace(/\/$/, "")}/${ROLE_SCHEMA_CODE}`, {
        RequestInfo: requestInfo(token),
        Mdms: {
          tenantId: target,
          schemaCode: ROLE_SCHEMA_CODE,
          uniqueIdentifier: `${ROLE_SCHEMA_CODE}.${code}`,
          isActive: true,
          data,
        },
      }, `${code} role create`);
    } catch (error) {
      if (!(error instanceof DigitUnavailableError) ||
          (error.status !== 400 && error.status !== 409)) throw error;
    }
  }

  // MDMS persistence is asynchronous. Do not let egov-user race the role
  // records; a visibility timeout is retryable by the onboarding saga.
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const visible = new Set((await roleRecords(token, target, requiredCodes))
      .filter((record) => record.isActive !== false)
      .map(roleCode));
    if (requiredCodes.every((code) => visible.has(code))) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new DigitUnavailableError("DIGIT accepted tenant roles but they are not visible yet");
}

async function ensureTenantRecord(
  token: string,
  signup: TenantFoundationSignup,
  adoptExisting: boolean,
): Promise<void> {
  if (await isActiveDigitTenant(signup.requestedTenantId)) {
    // Only a resume of THIS operation may find the tenant already there — it
    // created it on an earlier attempt. Any other signup that lands on an
    // existing tenant is a collision the caller's uniqueness check missed, and
    // completing it would hand the signer tenant-admin roles on somebody
    // else's tenant. Terminal, never retryable. (Dhruv review, #2088.)
    if (!adoptExisting) {
      throw new DigitUnavailableError(
        `DIGIT tenant ${signup.requestedTenantId} already exists`, 409,
      );
    }
    return;
  }
  const tenantId = signup.requestedTenantId;
  try {
    await post(`${config.digitMdmsCreateUrl.replace(/\/$/, "")}/tenant.tenants`, {
      RequestInfo: requestInfo(token),
      Mdms: {
        tenantId,
        schemaCode: "tenant.tenants",
        uniqueIdentifier: tenantId,
        isActive: true,
        data: {
          tenantId,
          code: tenantId,
          name: signup.accountName,
          description: `Independent root tenant for ${signup.accountName}`,
          imageId: null,
        },
      },
    }, "tenant record create");
  } catch (error) {
    if (!(error instanceof DigitUnavailableError) ||
        (error.status !== 400 && error.status !== 409)) throw error;
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    clearTenantCaches();
    if (await isActiveDigitTenant(tenantId)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new DigitUnavailableError("DIGIT accepted the tenant record but it is not visible yet");
}

/** egov-user writes PII, so even an otherwise empty tenant needs an encryption key. */
async function ensureEncryptionKey(signup: TenantFoundationSignup): Promise<void> {
  if (!config.digitEncGenerateKeyUrl) return;
  await post(config.digitEncGenerateKeyUrl, {
    RequestInfo: { apiId: "digit-identity-bff" },
    tenantId: signup.requestedTenantId,
  }, "encryption key generation");
}

/**
 * Creates only what is required for an independent root tenant to appear in
 * identity and own an egov-user account. Application configuration is deferred.
 *
 * `adoptExisting` must be true ONLY when the caller already knows this same
 * operation created the tenant (its TENANT_FOUNDATION step is complete).
 */
export async function ensureTenantFoundation(
  signup: TenantFoundationSignup,
  options: { adoptExisting: boolean },
): Promise<void> {
  await withDigitProvisioner(async (token) => {
    await ensureTenantSchema(token, signup.requestedTenantId);
    await ensureTenantRecord(token, signup, options.adoptExisting);
    await ensureTenantAdminRoles(token, signup.requestedTenantId);
  });
  await ensureEncryptionKey(signup);
}
