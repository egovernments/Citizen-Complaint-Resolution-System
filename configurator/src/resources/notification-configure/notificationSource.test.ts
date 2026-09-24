// What the notification banners tell an operator to RUN.
//
// Kanav review of #2097 (4079418192): since 96c96d1 a deploy only upgrades software and never
// copies a tenant's configuration, but the banners still said "re-run the notification seed
// step (./deploy.sh <tenant> --tags notifications)" — an operator following them saw nothing
// change. Moving a tenant is migrate-notifications.py; so is installing the defaults on an
// existing tenant with no configuration (the deploy seeds them on a fresh install only).
import { describe, it, expect } from 'vitest';
// The package source, not the built dist the bare package name resolves to under vitest.
import { readOnlyNoticeFor } from '../../../packages/data-provider/src/providers/resourceRegistry';
import {
  NOTIFICATION_ADOPT_DEFAULTS_COMMAND,
  NOTIFICATION_MIGRATE_COMMAND,
  namespaceSwitchMessage,
  selectNotificationSource,
} from './notificationSource';

const STALE = /seed step|copy step|re-run the deploy/i;

describe('notification banners name the command that actually does it', () => {
  const legacyRouting = selectNotificationSource({ modern: {}, legacy: { routing: 3 } });
  const legacyChannel = selectNotificationSource({ switchOn: 'channel', modern: {}, legacy: { channel: 3 } });
  const none = selectNotificationSource({ modern: {}, legacy: {} });

  it('an un-migrated tenant is sent to the migration script, not the deploy', () => {
    for (const d of [legacyRouting, legacyChannel]) {
      expect(d.source).toBe('LEGACY');
      expect(d.message).toContain(NOTIFICATION_MIGRATE_COMMAND);
      expect(d.message).not.toMatch(/deploy\.sh|--tags notifications/);
      expect(d.message).not.toMatch(STALE);
    }
  });

  it('a raw first NOTIFICATIONS row on a legacy tenant is refused with the migration command', () => {
    const msg = namespaceSwitchMessage('notifications-routing', legacyRouting, legacyChannel);
    expect(msg).toContain(NOTIFICATION_MIGRATE_COMMAND);
    expect(msg).not.toMatch(/deploy\.sh|--tags notifications/);
  });

  it('a tenant with no configuration is told how to install the defaults after a review', () => {
    expect(none.source).toBe('NONE');
    expect(none.message).toContain(NOTIFICATION_ADOPT_DEFAULTS_COMMAND);
    expect(NOTIFICATION_ADOPT_DEFAULTS_COMMAND).toContain('--adopt-defaults');
    // A deploy seeds defaults on a FRESH install only; the banner must not promise more.
    expect(none.message).toMatch(/fresh install/i);
    expect(none.message).not.toMatch(STALE);
  });

  it('the legacy-master notice (data-provider package) says the same command as the app', () => {
    for (const resource of ['notification-routing', 'notification-template', 'notification-provider-template', 'notification-channel']) {
      const notice = readOnlyNoticeFor(resource) ?? '';
      expect(notice).toContain(NOTIFICATION_MIGRATE_COMMAND);
      expect(notice).not.toMatch(/--tags notifications/);
      expect(notice).not.toMatch(STALE);
    }
  });
});
