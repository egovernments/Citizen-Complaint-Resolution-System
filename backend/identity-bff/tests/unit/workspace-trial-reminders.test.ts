import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { config } from "../../src/infrastructure/config.js";
import { setNotificationDispatcher, type NotificationEnvelope } from "../../src/integrations/novu-bridge.js";
import { dueReminder, reminderMarker, sendTrialReminder } from "../../src/modules/workspace-trial/reminders.js";

const mocks = vi.hoisted(() => ({ request: vi.fn(), update: vi.fn() }));
vi.mock("../../src/modules/organizations/organization-service.js", () => ({ request: mocks.request }));
vi.mock("../../src/modules/workspace-trial/routes.js", () => ({ updateTrial: mocks.update }));

const DAY = 86_400_000;
const start = Date.parse("2026-10-20T09:00:00.000Z");
const endsAt = new Date(start + 30 * DAY).toISOString();
const schedule = [14, 7, 3, 2, 1];
/** A moment on day `n` of the 30-day trial. */
const day = (n: number) => start + n * DAY;
const trial = (reminderSent?: string) => ({ endsAt, approvedAt: null, approvedBy: null, reminderSent });

describe("dueReminder", () => {
  it("lands on days 16, 23, 27, 28, 29 and 30 of a 30-day trial, once each", () => {
    const sent: Array<[number, number]> = [];
    let marker: string | undefined;
    for (let now = start; now <= day(32); now += 3_600_000) {
      const due = dueReminder(trial(marker), now, schedule);
      if (due === null) continue;
      sent.push([Math.floor((now - start) / DAY), due]);
      marker = reminderMarker(endsAt, due);
    }
    expect(sent).toEqual([[16, 14], [23, 7], [27, 3], [28, 2], [29, 1], [30, 0]]);
  });

  it("after downtime sends only the latest threshold crossed, never a backlog", () => {
    expect(dueReminder(trial(reminderMarker(endsAt, 14)), day(28.5), schedule)).toBe(2);
    expect(dueReminder(trial(reminderMarker(endsAt, 14)), day(45), schedule)).toBe(0);
    expect(dueReminder(trial(), day(45), schedule)).toBe(0);
  });

  it("an extended end date starts the schedule afresh", () => {
    const moved = { ...trial(reminderMarker(endsAt, 0)), endsAt: new Date(day(60)).toISOString() };
    expect(dueReminder(moved, day(31), schedule)).toBeNull();
    expect(dueReminder(moved, day(46), schedule)).toBe(14);
  });

  it("sends nothing for approved, trial-less or unparseable trials", () => {
    expect(dueReminder(null, day(29), schedule)).toBeNull();
    expect(dueReminder({ ...trial(), approvedAt: "2026-10-21T00:00:00Z" }, day(29), schedule)).toBeNull();
    expect(dueReminder({ ...trial(), endsAt: "soon" }, day(29), schedule)).toBeNull();
  });
});

describe("sendTrialReminder", () => {
  const saved = { ...config };
  const org = { id: "org", alias: "acme", name: 'Acme "<b>"', lifecycle: "ACTIVE" as const, enabled: true, trial: trial() };
  const account = (roles: Array<[string, string]>, { tenantId = "acme", active = true } = {}) => ({ "digit.accounts": [
    JSON.stringify({ v: 1, entries: [{ kind: "staff", tenantId, uuid: "u", boundAt: 1, active,
      roles: roles.map(([code, at]) => ({ code, tenantId: at })) }] })] });
  const ADMIN: Array<[string, string]> = [["ACCOUNT_ADMIN", "acme"]];
  const members = [
    { id: "founder", email: "founder@example.org", enabled: true, attributes: account([...ADMIN, ["EMPLOYEE", "acme"]]) },
    { id: "admin-without-email", enabled: true, attributes: account(ADMIN) },
    { id: "employee", email: "employee@example.org", enabled: true, attributes: account([["EMPLOYEE", "acme"]]) },
    { id: "disabled-admin", email: "disabled@example.org", enabled: false, attributes: account(ADMIN) },
    { id: "inactive-admin", email: "inactive@example.org", enabled: true, attributes: account(ADMIN, { active: false }) },
    { id: "admin-elsewhere", email: "elsewhere@example.org", enabled: true,
      attributes: account([["EMPLOYEE", "acme"], ["ACCOUNT_ADMIN", "other"]]) },
    { id: "account-at-another-root", email: "other@example.org", enabled: true, attributes: account(ADMIN, { tenantId: "other" }) },
    { id: "unreadable", email: "unreadable@example.org", enabled: true, attributes: { "digit.accounts": ["{"] } },
  ];
  let sent: NotificationEnvelope[];
  let warn: ReturnType<typeof vi.spyOn>;
  const warned = (outcome: string) => warn.mock.calls.some(([line]) => String(line).includes(`"outcome":"${outcome}"`));

  beforeEach(() => {
    vi.resetAllMocks();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    Object.assign(config, { workspaceTrialDays: 30, workspaceTrialReminderDays: schedule,
      novuBridgeUrl: "http://bridge", novuBridgeToken: "token", digitAdminTenantId: "pg",
      workspaceTrialNotice: { title: "Ended", message: 'Call "us"', linkLabel: "Contact", linkUrl: "https://example.org/?a=1&b=2" } });
    mocks.request.mockImplementation(async () => new Response(JSON.stringify(members)));
    sent = [];
    setNotificationDispatcher(async (envelope) => {
      sent.push(envelope);
      return { status: "SENT", diagnostics: [] };
    });
  });
  afterAll(() => {
    Object.assign(config, saved);
    setNotificationDispatcher();
    vi.restoreAllMocks();
  });

  it("emails only the workspace's enabled, active admins at its own root, through the platform tenant, then records it", async () => {
    await sendTrialReminder("acme", org, "active", day(23));
    expect(sent.map((envelope) => (envelope.contact as { email: string }).email)).toEqual(["founder@example.org"]);
    expect(sent[0]).toMatchObject({ eventType: "WORKSPACE_TRIAL", tenantId: "pg", entityId: "acme", channel: "EMAIL",
      subject: "The trial of Acme '<b>' ends in 7 days", transactionId: `workspace-trial:acme:${endsAt}:7:founder` });
    expect(sent[0].renderedBody).toContain("Acme &#34;&#60;b&#62;&#34;");
    expect(sent[0].renderedBody).toContain("<a href='https://example.org/?a=1&#38;b=2'>Contact</a>");
    // Novu 2.3.0 fails the email step on a double quote anywhere in the payload.
    expect(`${sent[0].subject}${sent[0].renderedBody}`).not.toContain('"');
    expect(warned("NO_EMAIL") && warned("ACCOUNTS_UNREADABLE")).toBe(true);
    const attributes: Record<string, string[]> = {};
    mocks.update.mock.calls[0][1](attributes);
    expect(attributes["digit.trialReminderSent"]).toEqual([`${endsAt}|7`]);
  });

  it("records nothing when a send fails or the bridge skips it, so the next pass retries", async () => {
    setNotificationDispatcher(async () => { throw new Error("down"); });
    await sendTrialReminder("acme", org, "active", day(23));
    setNotificationDispatcher(async () => ({ status: "SKIPPED", diagnostics: ["no provider"] }));
    await sendTrialReminder("acme", org, "active", day(23));
    expect(mocks.update).not.toHaveBeenCalled();
    expect(warned("SKIPPED")).toBe(true);
  });

  it("warns, and records once, when no admin could be emailed", async () => {
    mocks.request.mockImplementation(async () => new Response(JSON.stringify([members[2]])));
    await sendTrialReminder("acme", org, "active", day(23));
    expect(sent).toHaveLength(0);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(warned("NO_RECIPIENT")).toBe(true);
  });

  it("sends nothing while trials are off, for an inactive tenant or an unfinished Organization, or when nothing is due", async () => {
    config.workspaceTrialDays = 0;
    await sendTrialReminder("acme", org, "active", day(23));
    config.workspaceTrialDays = 30;
    await sendTrialReminder("acme", org, "TENANT_INACTIVE", day(23));
    await sendTrialReminder("acme", { ...org, enabled: false }, "active", day(23));
    await sendTrialReminder("acme", { ...org, lifecycle: "PROVISIONING" as const }, "active", day(23));
    await sendTrialReminder("acme", org, "active", day(10));
    await sendTrialReminder("acme", { ...org, trial: trial(reminderMarker(endsAt, 7)) }, "active", day(23));
    expect(mocks.request).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);
  });
});
