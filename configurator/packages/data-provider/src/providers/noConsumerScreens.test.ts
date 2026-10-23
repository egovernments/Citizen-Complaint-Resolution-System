import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { REGISTRY, NO_CONSUMER_ON_3X, getGenericMdmsResources, getResourceConfig } from './resourceRegistry.js';

// ours#854 / #855: Advanced offers no screen whose master nothing on 3.x reads.
describe('screens without a 3.x consumer', () => {
  it('are not generic screens (no Advanced card, no route)', () => {
    const generic = getGenericMdmsResources();
    for (const name of NO_CONSUMER_ON_3X) assert.equal(generic[name], undefined, name);
  });

  it('every hidden name is a real registry entry (a renamed one would silently reappear)', () => {
    for (const name of NO_CONSUMER_ON_3X) assert.ok(REGISTRY[name], name);
  });

  it('keeps the ones with a consumer', () => {
    const generic = getGenericMdmsResources();
    for (const name of ['auto-escalation', 'auto-escalation-ignore', 'security-policy', 'state-info']) {
      assert.ok(generic[name], name);
    }
  });

  it('hides SLA Config: dashboard colour slabs, not complaint SLAs, and nothing on 3.x reads them (#1553)', () => {
    assert.equal(getGenericMdmsResources()['sla-config'], undefined);
  });

  it('leaves the registry config readable', () => {
    assert.equal(getResourceConfig('inbox-config')?.schema, 'INBOX.InboxQueryConfiguration');
  });
});
