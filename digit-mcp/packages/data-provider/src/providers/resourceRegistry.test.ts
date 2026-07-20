import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  getResourceConfig, getAllResources, getDedicatedResources,
  getGenericMdmsResources, getResourceLabel, getResourceIdField,
  getResourceBySchema,
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
    const expected = ['tenants', 'departments', 'designations', 'complaint-types', 'employees', 'boundaries', 'complaints', 'localization'];
    for (const name of expected) {
      assert.ok(dedicated[name], `Missing dedicated resource: ${name}`);
    }
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
});
