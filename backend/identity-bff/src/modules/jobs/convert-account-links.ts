/** One-time item-19 conversion. Remove this CLI after all boxes have run it. */
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { initCache, closeCache } from "../../infrastructure/redis.js";
import { withPersonLease } from "../accounts/person-lease.js";
import { parseLink, type AccountLink } from "../account-links/account-links.js";
import { ensureActive, readBindingUser } from "../bindings/store.js";
import { BindingError } from "../bindings/types.js";
import { request, ensureOrganizationMembership } from "../organizations/organization-service.js";
import { updateKeycloakUser, type UserRepresentation } from "../sync/keycloak-writer.js";
import { accountEntries } from "../sync/state.js";
import { ensureCitizenEntry, mirrorPerson } from "../sync/mirror.js";
import { readDigitAccount, requireWorkspace } from "../workspace-members/authority.js";
import { mobileValidationForRoute } from "../citizen-otp/mobile-validation.js";
import { splitE164 } from "../citizens/citizen-registration.js";

export interface ConversionOutcome { subject: string; tenantId?: string; uuid?: string; status: "converted" | "already-converted" | "skipped" | "failed"; reason?: string }

async function seedCitizen(subject: string, link: AccountLink): Promise<boolean> {
  const user = await readBindingUser(subject);
  const phone = user.attributes?.phoneNumber?.[0];
  if (user.attributes?.phoneNumberVerified?.[0] !== "true" || !phone) throw new BindingError("PHONE_NOT_VERIFIED", "A verified phone is required");
  const account = await readDigitAccount(link.tenantId, link.digitUuid, "CITIZEN");
  if (!account) throw new BindingError("DIGIT_ACCOUNT_NOT_FOUND", "The citizen account is missing");
  const mobile = account.mobileNumber;
  if (mobile && /\*/.test(mobile)) throw new BindingError("DIGIT_PII_MASKED", "The citizen phone is masked");
  let matches = false;
  if (mobile?.startsWith("+")) matches = phone === mobile;
  else if (mobile && account.countryCode) matches = phone === `+${account.countryCode.replace(/^\+/, "")}${mobile}`;
  else if (mobile) {
    const org = await requireWorkspace(link.tenantId);
    const rule = await mobileValidationForRoute({ tenantId: link.tenantId, rootTenantId: link.tenantId,
      parentTenantId: null, fallbackTenantIds: [], name: org.name, urlSlug: org.alias });
    matches = !!rule && splitE164(phone, rule)?.mobileNumber === mobile;
  }
  if (!matches) throw Object.assign(new Error("The citizen phone does not match"), { code: "PHONE_MISMATCH" });
  const existed = accountEntries(user).some((entry) => entry.kind === "citizen" && entry.tenantId === link.tenantId);
  await ensureCitizenEntry(subject, { tenantId: link.tenantId, uuid: link.digitUuid });
  const created = !existed;
  return created;
}

export async function convertAccountLinks(): Promise<ConversionOutcome[]> {
  const outcomes: ConversionOutcome[] = [];
  for (let first = 0; ; first += 100) {
    const users = await (await request(`/users?briefRepresentation=false&first=${first}&max=100`)).json() as UserRepresentation[];
    for (const user of users) {
      if (!user.id || !user.attributes?.["digit.accountLinks"]?.length) continue;
      const subject = user.id;
      try {
        // Independent leases/failures: a bad person never prevents the next one.
        await withPersonLease(subject, async (lease) => {
          const fresh = await readBindingUser(subject);
          for (const value of fresh.attributes?.["digit.accountLinks"] || []) {
            const link = parseLink(value);
            if (!link) { outcomes.push({ subject, status: "skipped", reason: "INVALID_LINK" }); continue; }
            try {
              let created: boolean;
              if (link.userType === "EMPLOYEE") {
                const org = await requireWorkspace(link.tenantId);
                const result = await ensureActive({ subject, tenantId: link.tenantId, uuid: link.digitUuid, actor: { kind: "migration" } });
                created = result.created;
                await lease.assertHeld();
                await ensureOrganizationMembership({ organizationId: org.id, userId: subject });
                await mirrorPerson(subject);
              } else created = await seedCitizen(subject, link);
              await updateKeycloakUser(subject, (current) => ({ ...current, attributes: { ...current.attributes,
                "digit.accountLinks": (current.attributes?.["digit.accountLinks"] || []).filter((v) => v !== value) } }));
              outcomes.push({ subject, tenantId: link.tenantId, uuid: link.digitUuid, status: created ? "converted" : "already-converted" });
              console.info(JSON.stringify({ audit: "identity.account_link", event: "ACCOUNT_LINK_CONVERT", subject, tenantId: link.tenantId, digitUserUuid: link.digitUuid }));
            } catch (error) {
              const reason = typeof (error as { code?: unknown }).code === "string" ? (error as { code: string }).code : "IDENTITY_UNAVAILABLE";
              outcomes.push({ subject, tenantId: link.tenantId, uuid: link.digitUuid, status: reason.endsWith("UNAVAILABLE") || reason === "IDENTITY_BUSY" ? "failed" : "skipped", reason });
            }
          }
        });
      } catch (error) {
        outcomes.push({ subject, status: "failed", reason: typeof (error as { code?: unknown }).code === "string" ? (error as { code: string }).code : "IDENTITY_UNAVAILABLE" });
      }
    }
    if (users.length < 100) return outcomes;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  initCache();
  try {
    const outcomes = await convertAccountLinks();
    console.info(JSON.stringify({ converted: outcomes.filter((o) => o.status === "converted").length,
      alreadyConverted: outcomes.filter((o) => o.status === "already-converted").length,
      skipped: outcomes.filter((o) => o.status === "skipped").length, failed: outcomes.filter((o) => o.status === "failed").length,
      reasons: outcomes.filter((o) => o.reason).map(({ subject, tenantId, reason }) => ({ subject, tenantId, reason })) }));
    if (outcomes.some((o) => o.status === "failed")) process.exitCode = 1;
  } finally { await closeCache(); }
}
