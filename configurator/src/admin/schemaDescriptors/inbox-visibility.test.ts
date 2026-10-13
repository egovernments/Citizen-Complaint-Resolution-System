import { describe, expect, it } from 'vitest';
import { getDescriptor } from './index';

describe('inbox visibility and action mapping descriptors', () => {
  it('gives RAINMAKER-PGR.InboxVisibilityConfig a form for every field its readers use', () => {
    const d = getDescriptor('RAINMAKER-PGR.InboxVisibilityConfig');
    const byPath = Object.fromEntries((d?.fields ?? []).map((f) => [f.path, f]));
    expect(byPath.enabled?.widget).toBe('boolean');
    expect(byPath.serverSide?.widget).toBe('boolean');
    expect(byPath.reporteeDepth?.widget).toBe('integer');
    // unset reads as off: shown, not written
    expect(byPath.enabled?.whenUnset).toBe(false);
  });

  it("edits an action mapping's resource policy (masters conditions, complaint scope) as JSON", () => {
    const d = getDescriptor('ACCESSCONTROL-ACTIONS-TEST.actions-test');
    expect(d?.fields.find((f) => f.path === 'resource')?.widget).toBe('json');
  });
});
