import { randomUUID } from "node:crypto";
import { config } from "../../infrastructure/config.js";
import { paged } from "../../integrations/keycloak/admin-api.js";
import { dispatchNotification, novuBridgeConfigured } from "../../integrations/novu-bridge.js";
import type { RawTenantOrganization } from "../onboarding/organization-reader.js";
import type { UserRepresentation } from "../sync/keycloak-writer.js";
import { accountEntries } from "../sync/state.js";
import { updateTrial } from "./routes.js";
import { TRIAL_ATTRIBUTES, trialNotice, type WorkspaceTrial } from "./trial.js";

const DAY = 86_400_000;

export const reminderMarker = (endsAt: string, days: number) => `${endsAt}|${days}`;

function readMarker(value: string | null | undefined): { ends: number; days: number } | null {
  const at = value ? value.lastIndexOf("|") : -1;
  if (!value || at < 0) return null;
  const ends = Date.parse(value.slice(0, at));
  const days = Number(value.slice(at + 1));
  return Number.isNaN(ends) || !Number.isInteger(days) ? null : { ends, days };
}

/**
 * The reminder a trial is due for now, in days before its end (0 = the "locked" email at the
 * end), or null. Only the latest threshold crossed is due, so a BFF that was down sends one email,
 * never a backlog. One already sent for this end date is never due again, and a moved end date
 * (`_extend`) starts the schedule afresh, because the marker names the end date it was for.
 */
export function dueReminder(trial: WorkspaceTrial | null, now: number, days: number[]): number | null {
  if (!trial || trial.approvedAt) return null;
  const ends = Date.parse(trial.endsAt);
  if (Number.isNaN(ends)) return null;
  const crossed = [...days, 0].filter((threshold) => ends - now <= threshold * DAY);
  if (!crossed.length) return null;
  const due = Math.min(...crossed);
  const sent = readMarker(trial.reminderSent);
  return sent && sent.ends === ends && sent.days <= due ? null : due;
}

// Novu 2.3.0 fails an email step whose payload holds a double quote (StepControlCompilationFailedError,
// after accepting the trigger), so neither text may contain one: attributes are single-quoted.
const escapeHtml = (text: string) => text.replace(/[&<>"'\\]/g, (c) => `&#${c.charCodeAt(0)};`);
const plain = (text: string) => text.replace(/["\\]/g, "'");

/** The bridge's email workflow renders the body as HTML, so every operator or workspace text is escaped. */
export function reminderEmail(name: string, endsAt: string, days: number, now: number) {
  const ends = Date.parse(endsAt);
  const date = `${new Date(ends).toISOString().slice(0, 16).replace("T", " ")} UTC`;
  const notice = trialNotice();
  const link = notice.linkLabel && notice.linkUrl
    ? `<p><a href='${escapeHtml(notice.linkUrl)}'>${escapeHtml(notice.linkLabel)}</a></p>` : "";
  const workspace = escapeHtml(name);
  if (days === 0) {
    return { subject: `The trial of ${plain(name)} has ended`,
      body: `<p>The trial of the workspace ${workspace} ended on ${date}.</p><p>${escapeHtml(notice.message)}</p>${link}` };
  }
  const left = Math.max(1, Math.ceil((ends - now) / DAY));
  const unit = left === 1 ? "day" : "days";
  return { subject: `The trial of ${plain(name)} ends in ${left} ${unit}`,
    body: `<p>The trial of the workspace ${workspace} ends on ${date}, in ${left} ${unit}. After that, ` +
      `nobody can sign in to it until it is approved.</p>${link}` };
}

/** Organization members whose mirrored account at the tenant holds ACCOUNT_ADMIN there. */
async function workspaceAdmins(organizationId: string, tenantId: string): Promise<UserRepresentation[]> {
  const members = await paged<UserRepresentation>(
    `/organizations/${encodeURIComponent(organizationId)}/members?briefRepresentation=false`);
  return members.filter((member) => {
    if (!member.id || member.enabled === false) return false;
    try {
      return accountEntries(member).some((entry) => entry.kind === "staff" && entry.tenantId === tenantId &&
        entry.active && entry.roles.some((role) => role.code === "ACCOUNT_ADMIN" && role.tenantId === tenantId));
    } catch {
      return false;
    }
  });
}

let warnedOff = false;

/**
 * Reconcile calls this for every workspace on every pass. A due reminder goes to the workspace's
 * admins, then is recorded on the Organization. It never throws: email never holds up reconcile or
 * sign-in. A pass that could not reach every admin records nothing, so the next pass tries again,
 * and novu-bridge's ledger never sends one (workspace, end date, reminder, admin) twice.
 */
export async function sendTrialReminder(tenantId: string, org: RawTenantOrganization, now = Date.now()): Promise<void> {
  if (config.workspaceTrialDays <= 0 || !org.trial || !org.enabled ||
      (org.lifecycle !== null && org.lifecycle !== "ACTIVE")) return;
  const days = dueReminder(org.trial, now, config.workspaceTrialReminderDays);
  if (days === null) return;
  // The platform sends it, through the deployment's own providers: a trial workspace has none.
  const platformTenant = config.digitAdminTenantId.split(".")[0];
  if (!novuBridgeConfigured() || !platformTenant) {
    if (!warnedOff) console.warn(JSON.stringify({ trial: "identity.workspace_trial.reminders_off",
      reason: "IDENTITY_NOVU_BRIDGE_URL, IDENTITY_NOVU_BRIDGE_TOKEN and DIGIT_ADMIN_TENANT_ID are required" }));
    warnedOff = true;
    return;
  }
  const endsAt = new Date(Date.parse(org.trial.endsAt)).toISOString();
  const log = { trial: "identity.workspace_trial.reminder", tenantId, endsAt, days };
  try {
    const email = reminderEmail(org.name, endsAt, days, now);
    let sent = 0;
    let complete = true;
    for (const admin of await workspaceAdmins(org.id, tenantId)) {
      if (!admin.email) {
        console.warn(JSON.stringify({ ...log, subject: admin.id, outcome: "NO_EMAIL" }));
        continue;
      }
      const outcome = await dispatchNotification({
        schemaVersion: "1", eventId: randomUUID(), eventType: "WORKSPACE_TRIAL", eventTime: new Date(now).toISOString(),
        producer: "identity-bff", module: "identity",
        eventName: days === 0 ? "WORKSPACE_TRIAL.LOCKED" : "WORKSPACE_TRIAL.REMINDER",
        entityType: "WORKSPACE", entityId: tenantId, tenantId: platformTenant, channel: "EMAIL",
        subscriberId: `identity:${admin.id}`,
        contact: { userId: admin.id, type: "EMPLOYEE", name: admin.firstName, email: admin.email },
        subject: email.subject, renderedBody: email.body,
        transactionId: `workspace-trial:${tenantId}:${endsAt}:${days}:${admin.id}`,
        data: { workspaceTenantId: tenantId, trialEndsAt: endsAt, daysBefore: days },
      }).catch((error: Error) => ({ status: "ERROR", diagnostics: [error.message] }));
      if (outcome.status === "SENT" || outcome.status === "DELIVERED") sent++;
      else {
        complete = false;
        console.warn(JSON.stringify({ ...log, subject: admin.id, outcome: outcome.status, diagnostics: outcome.diagnostics }));
      }
    }
    if (complete) {
      await updateTrial(tenantId, (attributes) => {
        attributes[TRIAL_ATTRIBUTES.reminderSent] = [reminderMarker(endsAt, days)];
      });
    }
    console.info(JSON.stringify({ ...log, sent, recorded: complete }));
  } catch (error) {
    console.warn(JSON.stringify({ ...log, outcome: "FAILED", error: (error as Error).message }));
  }
}
