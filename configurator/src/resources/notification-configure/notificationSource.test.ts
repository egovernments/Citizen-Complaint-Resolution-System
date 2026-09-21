import { describe, it, expect } from 'vitest';
import {
  canWrite,
  selectNotificationSource,
  NOTIFICATION_SEED_COMMAND,
  type MasterCounts,
} from './notificationSource';

const none: MasterCounts = {};

describe('selectNotificationSource', () => {
  it('uses the NOTIFICATIONS namespace, writably, as soon as it holds anything', () => {
    const d = selectNotificationSource({ modern: { catalogue: 12 }, legacy: { routing: 41 } });
    expect(d.source).toBe('NOTIFICATIONS');
    expect(d.readOnly).toBe(false);
    expect(canWrite(d)).toBe(true);
    // Nothing to say: this is the normal state.
    expect(d.title).toBe('');
    expect(d.message).toBe('');
  });

  it('prefers the new namespace even when the legacy one has far more rows', () => {
    // All-or-nothing per tenant: whoever wins, wins for every master. A per-row
    // preference between two namespaces is unreasonable-at-2am territory.
    const d = selectNotificationSource({ modern: { routing: 1 }, legacy: { routing: 41, template: 60 } });
    expect(d.source).toBe('NOTIFICATIONS');
  });

  it('counts ANY new master, not just routing', () => {
    for (const key of ['catalogue', 'routing', 'template', 'providerTemplate', 'channel'] as const) {
      const d = selectNotificationSource({ modern: { [key]: 1 }, legacy: { routing: 5 } });
      expect(d.source, key).toBe('NOTIFICATIONS');
    }
  });

  it('falls back to the legacy rows READ-ONLY, and says what to run', () => {
    const d = selectNotificationSource({ modern: none, legacy: { routing: 41, template: 60 } });
    expect(d.source).toBe('LEGACY');
    expect(d.readOnly).toBe(true);
    expect(canWrite(d)).toBe(false);
    expect(d.rows).toBe(101);
    expect(d.title).toMatch(/not been migrated/i);
    expect(d.message).toContain(NOTIFICATION_SEED_COMMAND);
    // It must promise the copy is safe — otherwise nobody runs it on a live box.
    expect(d.message).toMatch(/never deletes/i);
  });

  it('reports an entirely unseeded tenant as NONE, not as "not migrated"', () => {
    const d = selectNotificationSource({ modern: none, legacy: none });
    expect(d.source).toBe('NONE');
    expect(d.readOnly).toBe(true);
    expect(d.title).toMatch(/No notification configuration/i);
    expect(d.message).toMatch(/NB_NO_ROUTING/);
    expect(d.message).toContain(NOTIFICATION_SEED_COMMAND);
  });

  it('says nothing at all while the lists are still loading', () => {
    // A loading race must not flash "this tenant has not been migrated" at an
    // operator whose tenant is perfectly fine.
    const d = selectNotificationSource({ pending: true, modern: none, legacy: { routing: 41 } });
    expect(d.title).toBe('');
    expect(d.message).toBe('');
    expect(d.level).toBe('none');
    // …and nothing may be written on the strength of a half-loaded picture.
    expect(canWrite(d)).toBe(false);
  });

  it('never marks a legacy or unseeded tenant writable', () => {
    for (const input of [
      { modern: none, legacy: { routing: 1 } },
      { modern: none, legacy: none },
      { pending: true, modern: { routing: 5 }, legacy: none },
    ]) {
      expect(canWrite(selectNotificationSource(input))).toBe(false);
    }
  });
});
