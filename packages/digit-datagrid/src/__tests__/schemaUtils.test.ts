import { describe, it, expect } from 'vitest';
import {
  getRefMap,
  orderFields,
  generateColumns,
  groupShowFields,
  formatFieldLabel,
  type SchemaDefinition,
} from '../columns/schemaUtils';

const ROLEACTIONS_SCHEMA: SchemaDefinition = {
  type: 'object',
  properties: {
    rolecode: { type: 'string' },
    actionid: { type: 'number' },
    tenantId: { type: 'string' },
    actioncode: { type: 'string' },
  },
  required: ['rolecode', 'actionid', 'tenantId'],
  'x-unique': ['rolecode', 'actionid'],
  'x-ref-schema': [
    { fieldPath: 'rolecode', schemaCode: 'ACCESSCONTROL-ROLES.roles' },
    { fieldPath: 'actionid', schemaCode: 'ACCESSCONTROL-ACTIONS-TEST.actions-test' },
  ],
};

const DEPARTMENT_SCHEMA: SchemaDefinition = {
  type: 'object',
  properties: {
    code: { type: 'string' },
    name: { type: 'string' },
    active: { type: 'boolean' },
  },
  required: ['code', 'name'],
  'x-unique': ['code'],
};

const SCHEMA_WITH_NESTED: SchemaDefinition = {
  type: 'object',
  properties: {
    key: { type: 'string' },
    items: { type: 'array', items: { type: 'object' } },
    config: { type: 'object' },
    active: { type: 'boolean' },
  },
  required: ['key'],
  'x-unique': ['key'],
};

describe('getRefMap', () => {
  it('builds fieldPath → { schemaCode, resource } map from x-ref-schema', () => {
    const lookup = (schema: string) => {
      if (schema === 'ACCESSCONTROL-ROLES.roles') return 'roles';
      if (schema === 'ACCESSCONTROL-ACTIONS-TEST.actions-test') return 'action-mappings';
      return undefined;
    };
    const refMap = getRefMap(ROLEACTIONS_SCHEMA, lookup);
    expect(refMap).toEqual({
      rolecode: { schemaCode: 'ACCESSCONTROL-ROLES.roles', resource: 'roles' },
      actionid: { schemaCode: 'ACCESSCONTROL-ACTIONS-TEST.actions-test', resource: 'action-mappings' },
    });
  });

  it('returns empty map when no x-ref-schema', () => {
    const refMap = getRefMap(DEPARTMENT_SCHEMA, () => undefined);
    expect(refMap).toEqual({});
  });

  it('omits entries where resource lookup fails', () => {
    const lookup = (schema: string) => {
      if (schema === 'ACCESSCONTROL-ROLES.roles') return 'roles';
      return undefined;
    };
    const refMap = getRefMap(ROLEACTIONS_SCHEMA, lookup);
    expect(Object.keys(refMap)).toEqual(['rolecode']);
  });
});

describe('orderFields', () => {
  it('orders: x-unique first, then required, then optional', () => {
    const fields = orderFields(ROLEACTIONS_SCHEMA);
    expect(fields).toEqual(['rolecode', 'actionid', 'tenantId', 'actioncode']);
  });

  it('handles schema with no x-unique gracefully', () => {
    const schema: SchemaDefinition = {
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'string' } },
      required: ['a'],
    };
    const fields = orderFields(schema);
    expect(fields).toEqual(['a', 'b']);
  });
});

describe('generateColumns', () => {
  it('generates columns from schema with correct order', () => {
    const refMap = {
      rolecode: { schemaCode: 'ACCESSCONTROL-ROLES.roles', resource: 'roles' },
      actionid: { schemaCode: 'ACCESSCONTROL-ACTIONS-TEST.actions-test', resource: 'action-mappings' },
    };
    const cols = generateColumns(ROLEACTIONS_SCHEMA, refMap);
    expect(cols.length).toBe(4);
    expect(cols[0].source).toBe('rolecode');
    expect(cols[1].source).toBe('actionid');
    expect(cols[2].source).toBe('tenantId');
    expect(cols[3].source).toBe('actioncode');
  });

  it('skips array and object fields', () => {
    const cols = generateColumns(SCHEMA_WITH_NESTED, {});
    const sources = cols.map((c) => c.source);
    expect(sources).not.toContain('items');
    expect(sources).not.toContain('config');
    expect(sources).toContain('key');
    expect(sources).toContain('active');
  });

  it('caps columns at 8', () => {
    const schema: SchemaDefinition = {
      type: 'object',
      properties: Object.fromEntries(
        Array.from({ length: 12 }, (_, i) => [`field${i}`, { type: 'string' }])
      ),
      required: Array.from({ length: 12 }, (_, i) => `field${i}`),
      'x-unique': ['field0'],
    };
    const cols = generateColumns(schema, {});
    expect(cols.length).toBeLessThanOrEqual(8);
  });

  it('adds render function for ref columns when renderRef provided', () => {
    const refMap = {
      rolecode: { schemaCode: 'ACCESSCONTROL-ROLES.roles', resource: 'roles' },
    };
    const mockRenderRef = (resource: string, id: string) => `${resource}:${id}`;
    const cols = generateColumns(ROLEACTIONS_SCHEMA, refMap, mockRenderRef);
    const roleCol = cols.find((c) => c.source === 'rolecode');
    expect(roleCol?.render).toBeDefined();
    // Non-ref column should NOT have render
    const tenantCol = cols.find((c) => c.source === 'tenantId');
    expect(tenantCol?.render).toBeUndefined();
  });

  it('does not add render function for ref columns when renderRef not provided', () => {
    const refMap = {
      rolecode: { schemaCode: 'ACCESSCONTROL-ROLES.roles', resource: 'roles' },
    };
    const cols = generateColumns(ROLEACTIONS_SCHEMA, refMap);
    const roleCol = cols.find((c) => c.source === 'rolecode');
    expect(roleCol?.render).toBeUndefined();
  });

  it('sets editable on non-key, non-ref columns', () => {
    const mockLookup = (schema: string) => {
      if (schema === 'ACCESSCONTROL-ROLES.roles') return 'roles';
      if (schema === 'ACCESSCONTROL-ACTIONS-TEST.actions-test') return 'action-mappings';
      return undefined;
    };
    const refMap = getRefMap(ROLEACTIONS_SCHEMA, mockLookup);
    const cols = generateColumns(ROLEACTIONS_SCHEMA, refMap);
    const tenantCol = cols.find((c) => c.source === 'tenantId');
    const actioncodeCol = cols.find((c) => c.source === 'actioncode');
    const rolecodeCol = cols.find((c) => c.source === 'rolecode');
    expect(tenantCol?.editable).toBe(true);
    expect(actioncodeCol?.editable).toBe(true);
    expect(rolecodeCol?.editable).toBeFalsy();
  });

  it('sets editable with type reference for non-key ref fields', () => {
    const schema: SchemaDefinition = {
      type: 'object',
      properties: {
        id: { type: 'string' },
        department: { type: 'string' },
        name: { type: 'string' },
      },
      required: ['id', 'department', 'name'],
      'x-unique': ['id'],
      'x-ref-schema': [
        { fieldPath: 'department', schemaCode: 'common-masters.Department' },
      ],
    };
    const refMap = getRefMap(schema, (code) => {
      if (code === 'common-masters.Department') return 'departments';
      return undefined;
    });
    const cols = generateColumns(schema, refMap);
    const deptCol = cols.find((c) => c.source === 'department');
    expect(deptCol?.editable).toEqual({
      type: 'reference',
      reference: 'departments',
      displayField: 'name',
    });
    // name is not a ref, should be plain editable
    const nameCol = cols.find((c) => c.source === 'name');
    expect(nameCol?.editable).toBe(true);
    // id is x-unique, not editable
    const idCol = cols.find((c) => c.source === 'id');
    expect(idCol?.editable).toBeFalsy();
  });

  it('sets editable with type number for number fields', () => {
    const schema: SchemaDefinition = {
      type: 'object',
      properties: {
        code: { type: 'string' },
        count: { type: 'number' },
        score: { type: 'integer' },
      },
      required: ['code', 'count'],
      'x-unique': ['code'],
    };
    const cols = generateColumns(schema, {});
    const countCol = cols.find((c) => c.source === 'count');
    const scoreCol = cols.find((c) => c.source === 'score');
    expect(countCol?.editable).toEqual({ type: 'number' });
    expect(scoreCol?.editable).toEqual({ type: 'number' });
  });

  it('sets editable with type boolean for boolean fields', () => {
    const schema: SchemaDefinition = {
      type: 'object',
      properties: {
        code: { type: 'string' },
        active: { type: 'boolean' },
      },
      required: ['code'],
      'x-unique': ['code'],
    };
    const cols = generateColumns(schema, {});
    const activeCol = cols.find((c) => c.source === 'active');
    expect(activeCol?.editable).toEqual({ type: 'boolean' });
  });

  it('sets editable with type date for date-format fields', () => {
    const schema: SchemaDefinition = {
      type: 'object',
      properties: {
        id: { type: 'string' },
        startDate: { type: 'string', format: 'date' },
        createdAt: { type: 'string', format: 'date-time' },
      },
      required: ['id'],
      'x-unique': ['id'],
    };
    const cols = generateColumns(schema, {});
    expect(cols.find((c) => c.source === 'startDate')?.editable).toEqual({ type: 'date' });
    expect(cols.find((c) => c.source === 'createdAt')?.editable).toEqual({ type: 'date' });
  });

  it('sets editable with type select for enum fields', () => {
    const schema: SchemaDefinition = {
      type: 'object',
      properties: {
        id: { type: 'string' },
        status: { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'PENDING'] },
      },
      required: ['id', 'status'],
      'x-unique': ['id'],
    };
    const cols = generateColumns(schema, {});
    expect(cols.find((c) => c.source === 'status')?.editable).toEqual({
      type: 'select',
      options: [
        { value: 'ACTIVE', label: 'ACTIVE' },
        { value: 'INACTIVE', label: 'INACTIVE' },
        { value: 'PENDING', label: 'PENDING' },
      ],
    });
  });
});

describe('groupShowFields', () => {
  it('groups fields into key, details, optional, complex sections', () => {
    const groups = groupShowFields(ROLEACTIONS_SCHEMA);
    expect(groups.key).toEqual(['rolecode', 'actionid']);
    expect(groups.details).toEqual(['tenantId']);
    expect(groups.optional).toEqual(['actioncode']);
    expect(groups.complex).toEqual([]);
  });

  it('puts array/object fields in complex group', () => {
    const groups = groupShowFields(SCHEMA_WITH_NESTED);
    expect(groups.complex).toEqual(['items', 'config']);
    expect(groups.key).toEqual(['key']);
    expect(groups.details).toEqual([]);
    expect(groups.optional).toEqual(['active']);
  });
});

describe('formatFieldLabel', () => {
  it('converts camelCase to Title Case', () => {
    expect(formatFieldLabel('rolecode')).toBe('Rolecode');
    expect(formatFieldLabel('actionId')).toBe('Action Id');
    expect(formatFieldLabel('businessService')).toBe('Business Service');
  });

  it('converts snake_case to Title Case', () => {
    expect(formatFieldLabel('tenant_id')).toBe('Tenant Id');
  });
});
