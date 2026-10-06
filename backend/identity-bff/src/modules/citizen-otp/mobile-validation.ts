import { config } from "../../infrastructure/config.js";
import { DigitUnavailableError } from "../managed-accounts/digit-user-client.js";
import type { PublicTenantRoute } from "../access-context/tenant-route.js";

export interface MobileValidation {
  countryCode: string;
  mobileNumberRegex: string;
  errorMessage?: string;
}

type MdmsRes = Record<string, Record<string, unknown[]>>;

async function searchMdmsV1(tenantId: string): Promise<MdmsRes> {
  if (!config.digitMdmsSearchUrl) {
    throw new DigitUnavailableError("DIGIT MDMS search is not configured");
  }
  const url = new URL(config.digitMdmsSearchUrl);
  url.searchParams.set("tenantId", tenantId);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        RequestInfo: { apiId: "digit-identity-bff" },
        MdmsCriteria: {
          tenantId,
          moduleDetails: [
            {
              moduleName: "common-masters",
              masterDetails: [
                { name: "MobileNumberValidation" },
              ],
            },
          ],
        },
      }),
      signal: AbortSignal.timeout(config.digitTimeoutMs),
    });
  } catch {
    throw new DigitUnavailableError("DIGIT mobile validation lookup failed");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new DigitUnavailableError(`DIGIT mobile validation lookup returned ${response.status}`);
  }
  const body = await response.json().catch(() => null) as { MdmsRes?: MdmsRes } | null;
  if (!body) throw new DigitUnavailableError("DIGIT mobile validation lookup returned invalid JSON");
  return body.MdmsRes || {};
}

function records(res: MdmsRes, moduleName: string, master: string): unknown[] {
  const values = res[moduleName]?.[master];
  return Array.isArray(values)
    ? values.filter((value) => (value as { isActive?: unknown })?.isActive !== false)
    : [];
}

/** Same selection as digit-ui citizen Login: the active default, else any active rule. */
export function pickMobileValidation(values: unknown[]): MobileValidation | null {
  const rules = values as Array<Record<string, unknown>>;
  const rule = rules.find((candidate) => candidate?.default === true) || rules[0];
  if (!rule || typeof rule.countryCode !== "string" || !rule.countryCode ||
      typeof rule.mobileNumberRegex !== "string" || !rule.mobileNumberRegex) {
    return null;
  }
  return {
    countryCode: rule.countryCode,
    mobileNumberRegex: rule.mobileNumberRegex,
    ...(typeof rule.errorMessage === "string" && rule.errorMessage && {
      errorMessage: rule.errorMessage,
    }),
  };
}

/** Phone possession must be checked against the current tenant rule. */
export async function mobileValidationForRoute(route: PublicTenantRoute): Promise<MobileValidation | null> {
  // Preserve the existing route/root fallback until the route contract removes
  // legacy subtenant records. With plain tenants these ids are identical.
  for (const tenantId of new Set([route.tenantId, route.rootTenantId])) {
    const result = await searchMdmsV1(tenantId);
    const values = records(result, "common-masters", "MobileNumberValidation");
    if (values.length) return pickMobileValidation(values);
  }
  return null;
}
