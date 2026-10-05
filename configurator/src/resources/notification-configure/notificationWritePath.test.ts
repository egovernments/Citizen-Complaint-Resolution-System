import { describe, it, expect, vi } from 'vitest';
import {
  saveNotificationPair,
  upsert,
  isMdmsDuplicate,
  ROUTING_RESOURCE,
  TEMPLATE_RESOURCE,
  type WritePathDeps,
} from './notificationWritePath';

const DUP = new Error("MDMS_DUPLICATE: create for 'x' returned no record — a record with this uniqueIdentifier already exists (possibly inactive).");

function makeDeps(overrides: Partial<WritePathDeps> = {}): WritePathDeps {
  return {
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    deleteOne: vi.fn(async () => ({})),
    ...overrides,
  };
}

const baseInput = {
  isEdit: false,
  keyUnchanged: false,
  routingUid: 'PGR.ASSIGN.PENDINGATLME.CITIZEN.SMS',
  templateUid: 'CITIZEN.ASSIGN.PENDINGATLME.SMS.en_IN',
  routingData: { audience: 'CITIZEN', channel: 'SMS' } as Record<string, unknown>,
  templateData: { audience: 'CITIZEN', channel: 'SMS', body: 'hi' } as Record<string, unknown>,
};

describe('isMdmsDuplicate', () => {
  it('detects the MDMS_DUPLICATE marker', () => {
    expect(isMdmsDuplicate(DUP)).toBe(true);
    expect(isMdmsDuplicate(new Error('SERVER_DOWN'))).toBe(false);
    expect(isMdmsDuplicate(undefined)).toBe(false);
  });
});

describe('saveNotificationPair', () => {
  it('C2/C4: duplicate create falls back to update-with-reactivation on the derived uid', async () => {
    const create = vi.fn(async (resource: string) => {
      if (resource === TEMPLATE_RESOURCE) throw DUP;
      return {};
    });
    const update = vi.fn(async () => ({}));
    const deps = makeDeps({ create, update });

    await saveNotificationPair(deps, baseInput);

    expect(update).toHaveBeenCalledWith(
      TEMPLATE_RESOURCE,
      expect.objectContaining({ id: baseInput.templateUid, meta: { includeInactive: true } }),
      { returnPromise: true },
    );
  });

  it('C2: propagates when the routing write fails after the template write (no success path)', async () => {
    const create = vi.fn(async (resource: string) => {
      if (resource === ROUTING_RESOURCE) throw new Error('BOOM');
      return {};
    });
    const deps = makeDeps({ create });

    await expect(saveNotificationPair(deps, baseInput)).rejects.toThrow('BOOM');
  });

  it('C3: key-changed edit deactivates the old routing + template pair after the new pair writes', async () => {
    const deps = makeDeps();

    await saveNotificationPair(deps, {
      ...baseInput,
      isEdit: true,
      keyUnchanged: false,
      seedRoutingId: 'PGR.ASSIGN.PENDINGATLME.CITIZEN.EMAIL',
      seedTemplateId: 'CITIZEN.ASSIGN.PENDINGATLME.EMAIL.en_IN',
    });

    expect(deps.deleteOne).toHaveBeenCalledWith(
      ROUTING_RESOURCE,
      { id: 'PGR.ASSIGN.PENDINGATLME.CITIZEN.EMAIL', previousData: {} },
      { returnPromise: true },
    );
    expect(deps.deleteOne).toHaveBeenCalledWith(
      TEMPLATE_RESOURCE,
      { id: 'CITIZEN.ASSIGN.PENDINGATLME.EMAIL.en_IN', previousData: {} },
      { returnPromise: true },
    );
  });

  it('C1: in-place edit with unchanged key uses plain updates (with returnPromise), no delete', async () => {
    const deps = makeDeps();

    await saveNotificationPair(deps, {
      ...baseInput,
      isEdit: true,
      keyUnchanged: true,
      seedRoutingId: baseInput.routingUid,
      seedTemplateId: baseInput.templateUid,
    });

    expect(deps.update).toHaveBeenCalledWith(
      TEMPLATE_RESOURCE,
      { id: baseInput.templateUid, data: baseInput.templateData, previousData: {} },
      { returnPromise: true },
    );
    expect(deps.deleteOne).not.toHaveBeenCalled();
    expect(deps.create).not.toHaveBeenCalled();
  });
});

describe('upsert', () => {
  it('rethrows a non-duplicate create error instead of updating', async () => {
    const create = vi.fn(async () => { throw new Error('SERVER_DOWN'); });
    const update = vi.fn(async () => ({}));
    const deps = makeDeps({ create, update });

    await expect(upsert(deps, TEMPLATE_RESOURCE, 'uid', {})).rejects.toThrow('SERVER_DOWN');
    expect(update).not.toHaveBeenCalled();
  });
});

describe('locale change on an existing routing row', () => {
  it('adds the new-locale template and updates routing in place; the old template survives', async () => {
    const calls: string[] = [];
    const deps = {
      create: async (r: string) => { calls.push(`create:${r}`); },
      update: async (r: string) => { calls.push(`update:${r}`); },
      deleteOne: async (r: string) => { calls.push(`delete:${r}`); },
    };
    await saveNotificationPair(deps, {
      isEdit: true,
      keyUnchanged: true,
      templateKeyUnchanged: false,
      routingUid: 'PGR.ASSIGN.PENDINGATLME.CITIZEN.SMS',
      templateUid: 'CITIZEN.ASSIGN.PENDINGATLME.SMS.hi_IN',
      routingData: {},
      templateData: {},
      seedRoutingId: 'PGR.ASSIGN.PENDINGATLME.CITIZEN.SMS',
      seedTemplateId: 'CITIZEN.ASSIGN.PENDINGATLME.SMS.en_IN',
    });
    expect(calls).toEqual([`create:${TEMPLATE_RESOURCE}`, `update:${ROUTING_RESOURCE}`]);
  });
});
