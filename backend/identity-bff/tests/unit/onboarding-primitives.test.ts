import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initCache, closeCache, getRedis } from "../../src/infrastructure/redis.js";
import { config } from "../../src/infrastructure/config.js";
import { OnboardingPrimitives, type OnboardingDependencies, type OnboardingOrganization } from "../../src/modules/onboarding/primitives.js";
import { withOnboardingLock } from "../../src/modules/onboarding/locks.js";

let records: Map<string, OnboardingOrganization>;
let deps: OnboardingDependencies;
let service: OnboardingPrimitives;
const input = { operationId: "operation-one", restartNo: 0, tenantId: "tenant-one", slug: "workspace-one", name: "Workspace One" };
const founder = { ...input, subject: "founder", digitUuid: "digit-founder" };
beforeAll(() => { initCache(`redis://127.0.0.1:${process.env.REDIS_PORT || 16389}`); });
afterAll(closeCache);
beforeEach(() => {
  config.cachePrefix = `onboarding-test-${randomUUID()}`;
  records = new Map();
  deps = {
    organizations: async () => structuredClone([...records.values()]),
    create: vi.fn(async (org) => { const record = { ...structuredClone(org), id: randomUUID() }; records.set(record.id, record); return structuredClone(record); }),
    update: vi.fn(async (org) => { records.set(org.id, structuredClone(org)); }),
    tenantExists: vi.fn(async () => true), identityExists: vi.fn(async () => true),
    membership: vi.fn(async () => {}), binding: vi.fn(async () => ({ binding: { state: "active" }, created: true })),
    revoke: vi.fn(async () => {}), invalidate: vi.fn(),
  };
  service = new OnboardingPrimitives(deps);
});

describe("onboarding primitives with Redis locks", () => {
  it("normalizes retries and rejects changed payload at the same restartNo", async () => {
    const first = await service.ensure(input);
    expect(first).toMatchObject({ created: true, organization: { lifecycle: "PROVISIONING", restartNo: 0 } });
    expect(await service.ensure({ ...input, name: "  Workspace\t One ", slug: "WORKSPACE-ONE" })).toEqual({ ...first, created: false });
    await expect(service.ensure({ ...input, name: "Different" })).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
    expect(deps.create).toHaveBeenCalledTimes(1);
  });

  it.each(["slug", "tenantId"] as const)("serializes concurrent %s reservations across operation owners", async (field) => {
    const other = { operationId: "operation-two", restartNo: 0, tenantId: "tenant-two", slug: "workspace-two", name: "Workspace Two", [field]: input[field] };
    const outcomes = await Promise.allSettled([service.ensure(input), service.ensure(other)]);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.find((result) => result.status === "rejected")).toMatchObject({ reason: { code: field === "slug" ? "SLUG_TAKEN" : "TENANT_TAKEN" } });
    expect(records.size).toBe(1);
  });

  it("rejects another operation adopting an existing Organization", async () => {
    await service.ensure(input);
    await expect(service.ensure({ ...input, operationId: "intruder" })).rejects.toMatchObject({ code: "TENANT_TAKEN" });
    expect(deps.membership).not.toHaveBeenCalled();
    expect(deps.binding).not.toHaveBeenCalled();
  });

  it("requires tenant foundation before creating the Organization", async () => {
    vi.mocked(deps.tenantExists).mockResolvedValue(false);
    await expect(service.ensure(input)).rejects.toMatchObject({ code: "TENANT_FOUNDATION_MISSING" });
    expect(records.size).toBe(0);
  });

  it("repeats ACTIVE and refuses reopening or a different terminal decision", async () => {
    await service.ensure(input);
    const active = await service.lifecycle({ ...input, state: "ACTIVE" });
    expect(await service.lifecycle({ ...input, state: "ACTIVE" })).toEqual(active);
    await expect(service.lifecycle({ ...input, state: "FAILED" })).rejects.toMatchObject({ code: "LIFECYCLE_CONFLICT" });
    await expect(service.ensure({ ...input, restartNo: 1 })).rejects.toMatchObject({ code: "LIFECYCLE_CONFLICT" });
    expect(deps.revoke).not.toHaveBeenCalled();
  });

  it.each(["PROVISIONING", "FAILED"] as const)("reopens %s and fences every lower-attempt mutation even after the newer attempt fails", async (state) => {
    await service.ensure(input);
    if (state === "FAILED") await service.lifecycle({ ...input, state });
    expect(await service.ensure({ ...input, restartNo: 1 })).toMatchObject({ created: false, organization: { lifecycle: "PROVISIONING", restartNo: 1 } });
    await service.lifecycle({ ...input, restartNo: 1, state: "FAILED" });
    const calls = [() => service.ensure(input), () => service.lifecycle({ ...input, state: "ACTIVE" }),
      () => service.membership(founder), () => service.binding(founder)];
    for (const call of calls) await expect(call()).rejects.toMatchObject({ code: "ATTEMPT_STALE" });
    expect(deps.membership).not.toHaveBeenCalled();
    expect(deps.binding).not.toHaveBeenCalled();
  });

  it("requires _ensure before higher-attempt lifecycle, membership and binding", async () => {
    await service.ensure(input);
    for (const call of [() => service.lifecycle({ ...input, restartNo: 1, state: "FAILED" }),
      () => service.membership({ ...founder, restartNo: 1 }), () => service.binding({ ...founder, restartNo: 1 })]) {
      await expect(call()).rejects.toMatchObject({ code: "OPERATION_NOT_FOUND" });
    }
  });

  it("preserves the old FAILED Organization when a restart changes the slug", async () => {
    const first = await service.ensure(input);
    await service.lifecycle({ ...input, state: "FAILED" });
    const second = await service.ensure({ ...input, restartNo: 1, slug: "new-slug" });
    expect(second.created).toBe(true);
    expect(second.organization.id).not.toBe(first.organization.id);
    expect(records.get(first.organization.id)).toMatchObject({ attributes: { "digit.lifecycle": ["FAILED"], "digit.supersededBy": [second.organization.id] } });
    expect(await service.ensure({ ...input, restartNo: 1, slug: "new-slug" })).toEqual({ ...second, created: false });
  });

  it("recovers a changed-slug crash before creation", async () => {
    await service.ensure(input);
    vi.mocked(deps.create).mockRejectedValueOnce(new Error("crash"));
    await expect(service.ensure({ ...input, restartNo: 1, slug: "new-slug" })).rejects.toThrow("crash");
    expect([...records.values()][0].attributes?.["digit.lifecycle"]).toEqual(["FAILED"]);
    expect(await service.ensure({ ...input, restartNo: 1, slug: "new-slug" })).toMatchObject({ created: true });
    expect(records.size).toBe(2);
  });

  it("recovers a changed-slug crash after creation but before supersession", async () => {
    const first = await service.ensure(input);
    const update = vi.mocked(deps.update).getMockImplementation()!;
    vi.mocked(deps.update).mockImplementationOnce(update).mockRejectedValueOnce(new Error("crash"));
    await expect(service.ensure({ ...input, restartNo: 1, slug: "new-slug" })).rejects.toThrow("crash");
    const retry = await service.ensure({ ...input, restartNo: 1, slug: "new-slug" });
    expect(retry.created).toBe(false);
    expect(records.get(first.organization.id)?.attributes?.["digit.supersededBy"]).toEqual([retry.organization.id]);
    expect(records.size).toBe(2);
  });

  it("replays FAILED revocation after interrupted publication and on every repeat", async () => {
    await service.ensure(input);
    vi.mocked(deps.revoke).mockRejectedValueOnce(new Error("publication interrupted"));
    await expect(service.lifecycle({ ...input, state: "FAILED" })).rejects.toThrow("publication interrupted");
    await service.lifecycle({ ...input, state: "FAILED" });
    await service.lifecycle({ ...input, state: "FAILED" });
    expect(deps.revoke).toHaveBeenCalledTimes(3);
    expect(deps.revoke).toHaveBeenLastCalledWith(input.tenantId);
  });

  it("validates ownership and founder existence before membership or binding", async () => {
    await service.ensure(input);
    await expect(service.membership({ ...founder, tenantId: "other" })).rejects.toMatchObject({ code: "OPERATION_NOT_FOUND" });
    vi.mocked(deps.identityExists).mockResolvedValue(false);
    await expect(service.binding(founder)).rejects.toMatchObject({ code: "IDENTITY_NOT_FOUND" });
    expect(deps.membership).not.toHaveBeenCalled();
    expect(deps.binding).not.toHaveBeenCalled();
  });

  it("does not perform a membership effect after losing the operation lease", async () => {
    await service.ensure(input);
    vi.mocked(deps.identityExists).mockImplementation(async () => {
      await getRedis().set(`${config.cachePrefix}:identity:op-lock:${input.operationId}`, "new-owner", "PX", 500);
      return true;
    });
    await expect(service.membership(founder)).rejects.toMatchObject({ code: "IDENTITY_BUSY" });
    expect(deps.membership).not.toHaveBeenCalled();
    expect(await getRedis().get(`${config.cachePrefix}:identity:op-lock:${input.operationId}`)).toBe("new-owner");
  });

  it("renews the lease and refuses a competing operation lock", async () => {
    await withOnboardingLock("op", "long-running", async (fence) => {
      await new Promise((resolve) => setTimeout(resolve, 120));
      await fence.assertHeld();
      await expect(withOnboardingLock("op", "long-running", async () => {}, undefined, { waitMs: 0 })).rejects.toMatchObject({ code: "IDENTITY_BUSY" });
    }, undefined, { ttlMs: 90 });
  });
});
