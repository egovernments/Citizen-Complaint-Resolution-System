import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({ signedIn: false, failure: "", surface: "", calls: [] as unknown[] }));
vi.mock("../../src/modules/sessions/current-session.js", () => ({ currentSession: vi.fn(async (_cookie: string, surface = "configurator") => {
  f.surface = surface;
  return f.signedIn ? { sessionId: "session", session: { claims: { sub: "person" } } } : null;
}) }));
vi.mock("../../src/modules/workspace-members/service.js", () => {
  const check = () => { if (f.failure) throw Object.assign(new Error("Refused"), { code: f.failure, ...(f.failure === "RESEND_TOO_SOON" && { retryAfter: 42 }) }); };
  return {
    linkWorkspaceMember: vi.fn(async (input: unknown) => { check(); f.calls.push(input); return { identityUserCreated: true, activationEmailSent: true, binding: { state: "active" } }; }),
    listWorkspaceMembers: vi.fn(async (...args: unknown[]) => { check(); f.calls.push(args); return { members: [] }; }),
    removeWorkspaceMember: vi.fn(async () => { check(); return { removed: true, state: "removed" }; }),
    acceptWorkspaceInvitation: vi.fn(async (...args: unknown[]) => { check(); f.calls.push(args); return { binding: { state: "active" } }; }),
    declineWorkspaceInvitation: vi.fn(async (...args: unknown[]) => { check(); f.calls.push(["decline", ...args]); return { declined: true }; }),
    updateWorkspaceMemberEmail: vi.fn(async () => { check(); return { status: "verification_sent" }; }),
  };
});
import { registerWorkspaceMemberRoutes } from "../../src/modules/workspace-members/routes.js";
import { contractRoute, expectContractError } from "./harness.js";
const routes = {
  link: contractRoute("POST", "/identity/v1/workspace-members/_link"),
  list: contractRoute("GET", "/identity/v1/workspace-members"),
  remove: contractRoute("POST", "/identity/v1/workspace-members/_remove"),
  accept: contractRoute("POST", "/identity/v1/workspace-invitations/_accept"),
  decline: contractRoute("POST", "/identity/v1/workspace-invitations/_decline"),
  email: contractRoute("POST", "/identity/v1/workspace-members/_updateEmail"),
};
const valid = { tenantId: "pg", digitUuid: "00000000-0000-4000-8000-000000000001", email: "employee@example.test" };
let server: Server, base: string;
beforeAll(async () => {
  const app = express(); app.use(express.json()); registerWorkspaceMemberRoutes(app);
  server = app.listen(0, "127.0.0.1"); await new Promise<void>((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
beforeEach(() => { f.signedIn = false; f.failure = ""; f.surface = ""; f.calls = []; });
const post = (path: string, body: unknown, origin?: string) => fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", ...(origin && { Origin: origin }) }, body: JSON.stringify(body) });

describe("workspace membership HTTP contract", () => {
  it.each(Object.values(routes))("requires a session: $path", async (route) => {
    const response = route.method === "GET" ? await fetch(base + route.path + "?tenantId=pg") : await post(route.path, valid);
    await expectContractError(response, route, "SESSION_REQUIRED");
  });
  it("requires email when linking an employee", async () => {
    f.signedIn = true;
    await expectContractError(await post(routes.link.path, { tenantId: valid.tenantId, digitUuid: valid.digitUuid }), routes.link, "INVALID_REQUEST");
  });
  it("returns the new-user activation contract", async () => {
    f.signedIn = true; const response = await post(routes.link.path, valid);
    expect(response.status).toBe(201); expect(await response.json()).toMatchObject({ identityUserCreated: true, activationEmailSent: true, binding: { state: "active" } });
  });
  it("exposes typed stale invitation conflicts", async () => {
    f.signedIn = true; f.failure = "INVITATION_STALE";
    await expectContractError(await post(routes.accept.path, { tenantId: "pg", invitationVersion: 1 }), routes.accept, "INVITATION_STALE");
  });
  it.each(["configurator", "employee"])("accepts through the %s surface's session", async (surface) => {
    f.signedIn = true; const response = await post(`${routes.accept.path}?surface=${surface}`, { tenantId: "pg", invitationVersion: 2 });
    expect(response.status).toBe(200); expect(f.surface).toBe(surface); expect(f.calls[0]).toEqual(["person", "pg", 2]);
  });
  it.each(["configurator", "employee"])("declines the caller's own invitation through the %s surface's session", async (surface) => {
    f.signedIn = true; const response = await post(`${routes.decline.path}?surface=${surface}`, { tenantId: "pg", invitationVersion: 2 });
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ declined: true });
    expect(f.surface).toBe(surface); expect(f.calls[0]).toEqual(["decline", "person", "pg", 2]);
  });
  it("rejects a decline through a citizen surface, without a version, or for a stale invitation", async () => {
    f.signedIn = true;
    await expectContractError(await post(`${routes.decline.path}?surface=citizen`, { tenantId: "pg", invitationVersion: 1 }), routes.decline, "UNSUPPORTED_SURFACE");
    await expectContractError(await post(routes.decline.path, { tenantId: "pg" }), routes.decline, "INVALID_REQUEST");
    f.failure = "INVITATION_STALE";
    await expectContractError(await post(routes.decline.path, { tenantId: "pg", invitationVersion: 1 }), routes.decline, "INVITATION_STALE");
  });
  it("rejects invitation acceptance through a citizen surface", async () => {
    f.signedIn = true;
    await expectContractError(await post(`${routes.accept.path}?surface=citizen`, { tenantId: "pg", invitationVersion: 1 }), routes.accept, "UNSUPPORTED_SURFACE");
  });
  it("keeps member pagination within the frozen bounds", async () => {
    f.signedIn = true;
    await expectContractError(await fetch(base + routes.list.path + "?tenantId=pg&max=501"), routes.list, "INVALID_REQUEST");
    expect(await (await fetch(base + routes.list.path + "?tenantId=pg")).json()).toEqual({ members: [] });
  });
  it("returns removed state", async () => {
    f.signedIn = true;
    expect(await (await post(routes.remove.path, valid)).json()).toEqual({ removed: true, state: "removed" });
  });
  it("returns 202 while email verification is pending", async () => {
    f.signedIn = true; const response = await post(routes.email.path, valid);
    expect(response.status).toBe(202); expect(await response.json()).toEqual({ status: "verification_sent" });
  });
  it("returns 403 when tenant authority cannot change a global identity email", async () => {
    f.signedIn = true; f.failure = "ADMIN_EMAIL_CHANGE_NOT_ALLOWED";
    await expectContractError(await post(routes.email.path, valid), routes.email, "ADMIN_EMAIL_CHANGE_NOT_ALLOWED");
  });
  it("returns the email collision contract", async () => {
    f.signedIn = true; f.failure = "IDENTITY_EMAIL_CHANGED";
    await expectContractError(await post(routes.email.path, valid), routes.email, "IDENTITY_EMAIL_CHANGED");
  });
  it("rejects an untrusted write Origin before acting", async () => {
    f.signedIn = true;
    await expectContractError(await post(routes.link.path, valid, "https://untrusted.example"), routes.link, "UNTRUSTED_ORIGIN");
    expect(f.calls).toEqual([]);
  });
  it("includes Retry-After for busy bindings", async () => {
    f.signedIn = true; f.failure = "BINDING_BUSY";
    await expectContractError(await post(routes.link.path, valid), routes.link, "BINDING_BUSY");
  });
  it("passes resend through _link and rejects it with reinvite", async () => {
    f.signedIn = true;
    expect((await post(routes.link.path, { ...valid, resend: true })).status).toBe(201);
    expect(f.calls[0]).toMatchObject({ resend: true });
    await expectContractError(await post(routes.link.path, { ...valid, resend: true, reinvite: true }), routes.link, "INVALID_REQUEST");
    await expectContractError(await post(routes.remove.path, { ...valid, resend: true }), routes.remove, "INVALID_REQUEST");
  });
  it("returns the resend cooldown with Retry-After", async () => {
    f.signedIn = true; f.failure = "RESEND_TOO_SOON";
    const response = await post(routes.link.path, { ...valid, resend: true });
    expect(response.headers.get("retry-after")).toBe("42");
    await expectContractError(response, routes.link, "RESEND_TOO_SOON");
  });
  it.each(["ACTIVATION_NOT_NEEDED", "IDENTITY_DISABLED"])("refuses a resend with %s", async (code) => {
    f.signedIn = true; f.failure = code;
    await expectContractError(await post(routes.link.path, { ...valid, resend: true }), routes.link, code);
  });
  it("accepts a member state filter, including removed", async () => {
    f.signedIn = true;
    await expectContractError(await fetch(base + routes.list.path + "?tenantId=pg&state=gone"), routes.list, "INVALID_REQUEST");
    expect((await fetch(base + routes.list.path + "?tenantId=pg&state=removed")).status).toBe(200);
    expect(f.calls[0]).toEqual(["person", "pg", 0, 100, "removed"]);
  });
});
