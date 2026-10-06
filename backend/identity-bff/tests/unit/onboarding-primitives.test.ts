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
    expect(records.get(first.organization.id)?.name).toBe(`Workspace One [failed ${first.organization.id.slice(0, 8)}]`);
    expect(records.get(second.organization.id)?.attributes?.["digit.lifecycleRestartNo"]).toEqual(["1"]);
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
    vi.mocked(deps.update).mockImplementationOnce(update).mockImplementationOnce(update).mockRejectedValueOnce(new Error("crash"));
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

  it.each(["workspace-one", "newer-slug"])("settles a permanent replacement-create collision, fences it and resumes at higher restart with %s", async (nextSlug) => {
    const first = await service.ensure(input);
    const create = vi.mocked(deps.create).getMockImplementation()!;
    vi.mocked(deps.create).mockRejectedValue(Object.assign(new Error("Name collision"), { code: "SLUG_TAKEN" }));
    const pending = { ...input, restartNo: 1, slug: "new-slug" };
    await expect(service.ensure(pending)).rejects.toMatchObject({ code: "SLUG_TAKEN" });
    vi.mocked(deps.revoke).mockRejectedValueOnce(new Error("publication interrupted"));
    await expect(service.lifecycle({ ...pending, state: "FAILED" })).rejects.toThrow("publication interrupted");
    expect(records.get(first.organization.id)?.attributes).toMatchObject({
      "digit.lifecycle": ["FAILED"], "digit.lifecycleRestartNo": ["1"],
      "digit.restartNo": ["0"], "digit.replacementPending": [expect.any(String)],
    });
    const settled = await service.lifecycle({ ...pending, state: "FAILED" });
    expect(settled.organization).toMatchObject({ id: first.organization.id, lifecycle: "FAILED", restartNo: 1 });
    expect(await service.lifecycle({ ...pending, state: "FAILED" })).toEqual(settled);
    expect(deps.revoke).toHaveBeenCalledTimes(4);
    await expect(service.ensure(pending)).rejects.toMatchObject({ code: "LIFECYCLE_CONFLICT" });
    await expect(service.ensure({ ...pending, name: "Changed" })).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
    for (const call of [() => service.ensure(input), () => service.lifecycle({ ...input, state: "FAILED" }),
      () => service.membership(founder), () => service.binding(founder)]) {
      await expect(call()).rejects.toMatchObject({ code: "ATTEMPT_STALE" });
    }
    for (const call of [() => service.lifecycle({ ...pending, state: "ACTIVE" }),
      () => service.membership({ ...founder, restartNo: 1 }), () => service.binding({ ...founder, restartNo: 1 })]) {
      await expect(call()).rejects.toMatchObject({ code: "OPERATION_NOT_FOUND" });
    }
    vi.mocked(deps.create).mockImplementation(create);
    expect(await service.ensure({ ...pending, restartNo: 2, slug: nextSlug })).toMatchObject({ organization: { lifecycle: "PROVISIONING", restartNo: 2 } });
    expect(records.get(first.organization.id)?.attributes?.["digit.replacementPending"]).toBeUndefined();
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
  it.each([undefined, "-1", "NaN", "1.2", "01", "9007199254740992"])("fails closed on invalid stored restart metadata %s for every mutation", async (restart) => {
    const first = await service.ensure(input);
    const org = records.get(first.organization.id)!;
    if (restart === undefined) delete org.attributes!["digit.restartNo"];
    else org.attributes!["digit.restartNo"] = [restart];
    for (const call of [() => service.ensure(input), () => service.lifecycle({ ...input, state: "ACTIVE" }),
      () => service.membership(founder), () => service.binding(founder)]) {
      await expect(call()).rejects.toMatchObject({ code: "IDENTITY_UNAVAILABLE" });
    }
    expect(deps.membership).not.toHaveBeenCalled();
    expect(deps.binding).not.toHaveBeenCalled();
  });
  it("rejects ambiguous same-operation same-attempt authority before effects", async () => {
    const first = await service.ensure(input);
    records.set("duplicate", { ...structuredClone(records.get(first.organization.id)!), id: "duplicate" });
    for (const call of [() => service.ensure(input), () => service.lifecycle({ ...input, state: "FAILED" }),
      () => service.membership(founder), () => service.binding(founder)]) {
      await expect(call()).rejects.toMatchObject({ code: "IDENTITY_UNAVAILABLE" });
    }
    expect(deps.update).not.toHaveBeenCalled();
    expect(deps.revoke).not.toHaveBeenCalled();
  });
  it.each(["after-stage", "before-rename", "after-rename", "during-revocation", "before-create"])("fences old attempts when replacement crashes %s", async (boundary) => {
    const first = await service.ensure(input);
    const update = vi.mocked(deps.update).getMockImplementation()!;
    let writes = 0;
    vi.mocked(deps.update).mockImplementation(async (org) => {
      writes++;
      if (boundary === "before-rename" && writes === 2) throw new Error("crash");
      await update(org);
      if ((boundary === "after-stage" && writes === 1) || (boundary === "after-rename" && writes === 2)) throw new Error("crash");
    });
    if (boundary === "during-revocation") vi.mocked(deps.revoke).mockRejectedValueOnce(new Error("crash"));
    if (boundary === "before-create") vi.mocked(deps.create).mockRejectedValueOnce(new Error("crash"));
    const next = { ...input, restartNo: 1, slug: "replacement" };
    await expect(service.ensure(next)).rejects.toThrow("crash");
    expect(records.get(first.organization.id)?.attributes?.["digit.replacementPending"]).toHaveLength(1);
    for (const call of [() => service.ensure(input), () => service.lifecycle({ ...input, state: "FAILED" }),
      () => service.membership(founder), () => service.binding(founder)]) {
      await expect(call()).rejects.toMatchObject({ code: "ATTEMPT_STALE" });
    }
    for (const call of [() => service.lifecycle({ ...next, state: "ACTIVE" }),
      () => service.membership({ ...founder, restartNo: 1 }), () => service.binding({ ...founder, restartNo: 1 })]) {
      await expect(call()).rejects.toMatchObject({ code: "OPERATION_NOT_FOUND" });
    }
    await expect(service.ensure({ ...next, name: "changed" })).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
    const recovered = await service.ensure(next);
    expect(recovered.organization).toMatchObject({ lifecycle: "PROVISIONING", restartNo: 1 });
    expect(records.get(first.organization.id)?.attributes?.["digit.replacementPending"]).toBeUndefined();
    expect(deps.revoke).toHaveBeenCalledWith(input.tenantId);
  });
  it("clears a marker after create without revoking a now-ACTIVE replacement", async () => {
    const first = await service.ensure(input);
    const create = vi.mocked(deps.create).getMockImplementation()!;
    vi.mocked(deps.create).mockImplementationOnce(async (org) => { await create(org); throw new Error("lost creation response"); });
    const next = { ...input, restartNo: 1, slug: "replacement" };
    await expect(service.ensure(next)).rejects.toThrow("lost creation response");
    await service.lifecycle({ ...next, state: "ACTIVE" });
    const revocations = vi.mocked(deps.revoke).mock.calls.length;
    const recovered = await service.ensure(next);
    expect(recovered).toMatchObject({ created: false, organization: { lifecycle: "ACTIVE", restartNo: 1 } });
    expect(records.get(first.organization.id)?.attributes?.["digit.supersededBy"]).toEqual([recovered.organization.id]);
    expect(records.get(first.organization.id)?.attributes?.["digit.replacementPending"]).toBeUndefined();
    expect(deps.revoke).toHaveBeenCalledTimes(revocations);
  });
  it("keeps the pending high-water mark monotonic through another failed restart", async () => {
    await service.ensure(input);
    vi.mocked(deps.create).mockRejectedValueOnce(new Error("crash"));
    await expect(service.ensure({ ...input, restartNo: 1, slug: "first-replacement" })).rejects.toThrow("crash");
    await service.ensure({ ...input, restartNo: 2, slug: "second-replacement" });
    await service.lifecycle({ ...input, restartNo: 2, state: "FAILED" });
    await expect(service.ensure({ ...input, restartNo: 1, slug: "first-replacement" })).rejects.toMatchObject({ code: "ATTEMPT_STALE" });
    await expect(service.binding({ ...founder, restartNo: 1 })).rejects.toMatchObject({ code: "ATTEMPT_STALE" });
  });
  it("reserves the pending tenant and slug against other operations during a crash", async () => {
    await service.ensure(input);
    vi.mocked(deps.create).mockRejectedValueOnce(new Error("crash"));
    await expect(service.ensure({ ...input, restartNo: 1, tenantId: "pending-tenant", slug: "pending-slug" })).rejects.toThrow("crash");
    await expect(service.ensure({ ...input, operationId: "other", tenantId: "pending-tenant", slug: "other-slug" })).rejects.toMatchObject({ code: "TENANT_TAKEN" });
    await expect(service.ensure({ ...input, operationId: "other", tenantId: "other-tenant", slug: "pending-slug" })).rejects.toMatchObject({ code: "SLUG_TAKEN" });
  });
  it.each(["invalid-json", "{}", '{"restartNo":0}', '{"restartNo":1,"operationHash":"wrong","tenantId":"tenant","slug":"slug","name":"name"}'])("fails closed for corrupt pending marker %s", async (marker) => {
    const first = await service.ensure(input);
    records.get(first.organization.id)!.attributes!["digit.replacementPending"] = [marker];
    await expect(service.ensure({ ...input, restartNo: 1, slug: "replacement" })).rejects.toMatchObject({ code: "IDENTITY_UNAVAILABLE" });
    await expect(service.membership(founder)).rejects.toMatchObject({ code: "IDENTITY_UNAVAILABLE" });
  });
});
