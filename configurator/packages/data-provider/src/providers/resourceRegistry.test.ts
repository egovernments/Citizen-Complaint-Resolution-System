import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  getResourceConfig, getAllResources, getDedicatedResources,
  getGenericMdmsResources, getResourceLabel, getResourceIdField,
  getResourceBySchema, isReadOnlyResource, readOnlyNoticeFor,
} from './resourceRegistry.js';

describe('resourceRegistry', () => {
  it('returns config for departments', () => {
    const config = getResourceConfig('departments');
    assert.ok(config);
    assert.equal(config.type, 'mdms');
    assert.equal(config.schema, 'common-masters.Department');
    assert.equal(config.idField, 'code');
  });

  it('returns config for employees (hrms)', () => {
    const config = getResourceConfig('employees');
    assert.ok(config);
    assert.equal(config.type, 'hrms');
    assert.equal(config.idField, 'uuid');
  });

  it('returns config for complaints (pgr)', () => {
    const config = getResourceConfig('complaints');
    assert.ok(config);
    assert.equal(config.type, 'pgr');
    assert.equal(config.idField, 'serviceRequestId');
  });

  it('returns undefined for unknown resource', () => {
    assert.equal(getResourceConfig('nonexistent'), undefined);
  });

  it('getDedicatedResources excludes generic MDMS', () => {
    const dedicated = getDedicatedResources();
    assert.ok(dedicated['departments']);
    assert.ok(dedicated['employees']);
    assert.equal(dedicated['state-info'], undefined);
  });

  it('getGenericMdmsResources excludes dedicated', () => {
    const generic = getGenericMdmsResources();
    assert.ok(generic['state-info']);
    assert.equal(generic['departments'], undefined);
    assert.equal(generic['employees'], undefined);
  });

  it('getResourceLabel returns label for known resource', () => {
    assert.equal(getResourceLabel('departments'), 'Departments');
  });

  it('getResourceLabel capitalizes unknown resource', () => {
    assert.equal(getResourceLabel('foo'), 'Foo');
  });

  it('getResourceIdField returns idField for known resource', () => {
    assert.equal(getResourceIdField('departments'), 'code');
    assert.equal(getResourceIdField('employees'), 'uuid');
  });

  it('getResourceIdField returns id for unknown resource', () => {
    assert.equal(getResourceIdField('unknown'), 'id');
  });

  it('has all expected dedicated resources', () => {
    const dedicated = getDedicatedResources();
    // complaint types are now the LEAF view of the single ComplaintHierarchy
    // master, exposed as the dedicated 'complaint-hierarchy' resource.
    const expected = ['tenants', 'departments', 'designations', 'complaint-hierarchy', 'employees', 'boundaries', 'complaints', 'localization'];
    for (const name of expected) {
      assert.ok(dedicated[name], `Missing dedicated resource: ${name}`);
    }
  });

  it('complaint-hierarchy is the ComplaintHierarchy leaf-adapter resource', () => {
    const config = getResourceConfig('complaint-hierarchy');
    assert.ok(config);
    assert.equal(config.schema, 'RAINMAKER-PGR.ComplaintHierarchy');
    assert.equal(config.idField, 'code');
    assert.equal(config.leafServiceDefAdapter, true);
  });

  it('drops the removed ServiceDefs / ClassificationNode resources', () => {
    assert.equal(getResourceConfig('complaint-types'), undefined);
    assert.equal(getResourceConfig('classification-nodes'), undefined);
    assert.equal(getResourceBySchema('RAINMAKER-PGR.ServiceDefs'), undefined);
    assert.equal(getResourceBySchema('RAINMAKER-PGR.ClassificationNode'), undefined);
  });

  it('getAllResources returns both dedicated and generic', () => {
    const all = getAllResources();
    assert.ok(Object.keys(all).length > 15, 'Should have 15+ resources');
    assert.ok(all['departments']);
    assert.ok(all['state-info']);
  });

  it('getResourceBySchema returns resource name for known schema', () => {
    const result = getResourceBySchema('common-masters.Department');
    assert.strictEqual(result, 'departments');
  });

  it('getResourceBySchema returns undefined for unknown schema', () => {
    const result = getResourceBySchema('nonexistent.Schema');
    assert.strictEqual(result, undefined);
  });

  it('getResourceBySchema finds role-actions by schema code', () => {
    const result = getResourceBySchema('ACCESSCONTROL-ROLEACTIONS.roleactions');
    assert.strictEqual(result, 'role-actions');
  });

  it('covers schemas registered on ke tenant that previously had no UI', () => {
    // Pin Stage-0 hygiene: these schemas live on `ke` but were invisible in
    // the configurator before. If a future refactor drops one, this fails loud.
    const expected: Record<string, string> = {
      'theme-config': 'common-masters.ThemeConfig',
      'mobile-number-validation': 'common-masters.MobileNumberValidation',
      'tenant-boundary': 'egov-location.TenantBoundary',
      'auto-escalation-ignore': 'Workflow.AutoEscalationStatesToIgnore',
      'workflow-bs-master': 'Workflow.BusinessServiceMasterConfig',
      'pgr-ui-constants': 'RAINMAKER-PGR.UIConstants',
      'pgr-escalation': 'RAINMAKER-PGR.EscalationConfig',
    };
    for (const [resource, schema] of Object.entries(expected)) {
      const cfg = getResourceConfig(resource);
      assert.ok(cfg, `Missing resource ${resource}`);
      assert.strictEqual(cfg.schema, schema, `${resource} should point to ${schema}`);
    }
    // Old aliases must be gone — a single canonical key avoids confusion
    assert.strictEqual(getResourceConfig('user-validation'), undefined, 'user-validation alias must be removed');
    assert.strictEqual(getResourceConfig('mobile-validation'), undefined, 'mobile-validation alias must be removed');
  });

  it('never keys a master on a value operators edit (#1252)', () => {
    // pgr-ui-constants used to declare idField: 'REOPENSLA' — the record's only
    // value doubling as its key. mdms-v2 rejects updates that change an x-unique
    // field, so Save on the reopen window always returned 400
    // UNIQUE_KEY_UPDATE_ERR and the window could not be changed by any route.
    const uiConstants = getResourceConfig('pgr-ui-constants');
    assert.ok(uiConstants);
    assert.strictEqual(uiConstants.idField, 'code');
    // Same defect, same fix, one master earlier — keep both honest.
    assert.strictEqual(getResourceConfig('map-config')?.idField, 'code');
  });

  it('does not register schemas that do not exist on ke (phantom cleanup)', () => {
    // `tenant.branding` is not registered on `ke` — the previous `branding`
    // entry 404'd. Keep this assertion until branding becomes a real schema.
    assert.strictEqual(getResourceBySchema('tenant.branding'), undefined);
    assert.strictEqual(getResourceConfig('branding'), undefined);
  });
});

// Analytics destinations must stay OUT of the generic MDMS resources: that is the
// single switch keeping the auto-generated CRUD routes, the Advanced nav sub-list
// and the /manage/advanced card grid from exposing a screen whose generic
// update/delete would rewrite or deactivate rows owned by the parent tenant.
describe('analytics providers', () => {
  it('is a dedicated resource, never a generic one', () => {
    const config = getResourceConfig('analytics-providers');
    assert.ok(config, 'analytics-providers must be registered');
    assert.equal(config!.schema, 'common-masters.AnalyticsProvider');
    assert.equal(config!.type, 'mdms');
    assert.equal(config!.idField, 'code');
    assert.equal(config!.dedicated, true);
    assert.ok(getDedicatedResources()['analytics-providers'], 'must appear in the dedicated set');
    assert.equal(
    getGenericMdmsResources()['analytics-providers'],
    undefined,
    'must NOT appear in the generic set — the generic CRUD is unsafe for this master'
  );
    assert.equal(getResourceBySchema('common-masters.AnalyticsProvider'), 'analytics-providers');
  });
});

// ---------------------------------------------------------------------------
// Notification configuration: the shared NOTIFICATIONS.* namespace, plus the
// legacy PGR masters kept READ-ONLY for one release.
// ---------------------------------------------------------------------------
describe('notification masters', () => {
  const NEW = {
    'notifications-event-catalogue': 'NOTIFICATIONS.EventCatalogue',
    'notifications-routing': 'NOTIFICATIONS.Routing',
    'notifications-template': 'NOTIFICATIONS.Template',
    'notifications-provider-template': 'NOTIFICATIONS.ProviderTemplate',
    'notifications-channel': 'NOTIFICATIONS.Channel',
  } as const;

  const LEGACY = {
    'notification-routing': 'RAINMAKER-PGR.NotificationRouting',
    'notification-template': 'RAINMAKER-PGR.NotificationTemplate',
    'notification-provider-template': 'RAINMAKER-PGR.NotificationProviderTemplate',
    'notification-channel': 'RAINMAKER-PGR.NotificationChannel',
  } as const;

  it('registers all five new masters, read and written at the STATE tenant', () => {
    for (const [name, schema] of Object.entries(NEW)) {
      const config = getResourceConfig(name);
      assert.ok(config, `${name} must be registered`);
      assert.equal(config!.schema, schema);
      assert.equal(config!.type, 'mdms');
      // The backend reads these only at the state root; a city-scoped operator
      // must never author rows nothing reads.
      assert.equal(config!.stateLevel, true, `${name} must be stateLevel`);
      assert.equal(getResourceBySchema(schema), name);
    }
  });

  it('leaves routing/template/provider-template/channel writable', () => {
    for (const name of ['notifications-routing', 'notifications-template', 'notifications-provider-template', 'notifications-channel']) {
      assert.equal(isReadOnlyResource(name), false, `${name} must stay writable`);
      assert.equal(readOnlyNoticeFor(name), undefined);
    }
  });

  it('keeps the module-owned event catalogue read-only, with a reason', () => {
    // PGR's rows are generated from its workflow at seed time; a new event
    // arrives with the module that fires it, not from this screen.
    assert.equal(isReadOnlyResource('notifications-event-catalogue'), true);
    assert.ok((readOnlyNoticeFor('notifications-event-catalogue') ?? '').length > 40);
  });

  it('keeps every legacy master registered, listable and READ-ONLY', () => {
    for (const [name, schema] of Object.entries(LEGACY)) {
      const config = getResourceConfig(name);
      assert.ok(config, `${name} must stay registered — it is still live configuration on an un-migrated tenant`);
      assert.equal(config!.schema, schema);
      assert.equal(isReadOnlyResource(name), true, `${name} must be read-only`);
      assert.match(config!.label, /^Legacy \(PGR\)/, `${name}'s label must say it is legacy`);
      const notice = readOnlyNoticeFor(name);
      assert.ok(notice, `${name} must explain where its configuration moved`);
      assert.match(notice!, /NOTIFICATIONS\.\*/);
      assert.match(notice!, /--tags notifications/);
      assert.match(notice!, /never deleted/);
    }
  });

  it('leaves the three bridge-proxied notification resources untouched', () => {
    for (const name of ['notification-log', 'notification-provider', 'notification-preference']) {
      const config = getResourceConfig(name);
      assert.ok(config);
      assert.equal(config!.type, 'custom');
      assert.equal(isReadOnlyResource(name), false);
    }
  });
});
