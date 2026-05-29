import { describe, it, expect } from 'vitest';
import { generateFilterElements } from '../columns/schemaUtils';
import type { SchemaDefinition, RefMapEntry } from '../columns/schemaUtils';

describe('generateFilterElements', () => {
  it('always prepends SearchFilterInput with source="q"', () => {
    const schema: SchemaDefinition = {
      type: 'object',
      properties: { name: { type: 'string' } },
    };
    const elements = generateFilterElements(schema, {});
    expect(elements.length).toBeGreaterThanOrEqual(1);
    expect(elements[0].props.source).toBe('q');
    expect(elements[0].props.alwaysOn).toBe(true);
  });

  it('generates SelectFilterInput for enum fields', () => {
    const schema: SchemaDefinition = {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['active', 'inactive', 'pending'] },
      },
    };
    const elements = generateFilterElements(schema, {});
    const statusFilter = elements.find((el) => el.props.source === 'status');
    expect(statusFilter).toBeDefined();
    expect(statusFilter!.props.choices).toHaveLength(3);
  });

  it('generates NullableBooleanFilterInput for boolean fields', () => {
    const schema: SchemaDefinition = {
      type: 'object',
      properties: {
        isActive: { type: 'boolean' },
      },
    };
    const elements = generateFilterElements(schema, {});
    const boolFilter = elements.find((el) => el.props.source === 'isActive');
    expect(boolFilter).toBeDefined();
  });

  it('generates ReferenceFilterInput for ref fields', () => {
    const schema: SchemaDefinition = {
      type: 'object',
      properties: { department: { type: 'string' } },
    };
    const refMap: Record<string, RefMapEntry> = {
      department: { schemaCode: 'dept', resource: 'departments' },
    };
    const elements = generateFilterElements(schema, refMap);
    const refFilter = elements.find((el) => el.props.source === 'department');
    expect(refFilter).toBeDefined();
    expect(refFilter!.props.reference).toBe('departments');
  });

  it('generates DateFilterInput for date/date-time format fields', () => {
    const schema: SchemaDefinition = {
      type: 'object',
      properties: {
        startDate: { type: 'string', format: 'date' },
      },
    };
    const elements = generateFilterElements(schema, {});
    const dateFilter = elements.find((el) => el.props.source === 'startDate');
    expect(dateFilter).toBeDefined();
  });

  it('skips x-unique fields', () => {
    const schema: SchemaDefinition = {
      type: 'object',
      properties: {
        code: { type: 'string' },
        name: { type: 'string' },
      },
      'x-unique': ['code'],
    };
    const elements = generateFilterElements(schema, {});
    const codeFilter = elements.find((el) => el.props.source === 'code');
    expect(codeFilter).toBeUndefined();
  });

  it('marks required enum/boolean/ref fields as alwaysOn', () => {
    const schema: SchemaDefinition = {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['a', 'b'] },
      },
      required: ['status'],
    };
    const elements = generateFilterElements(schema, {});
    const statusFilter = elements.find((el) => el.props.source === 'status');
    expect(statusFilter!.props.alwaysOn).toBe(true);
  });

  it('generates TextFilterInput for first 2 required string fields only', () => {
    const schema: SchemaDefinition = {
      type: 'object',
      properties: {
        firstName: { type: 'string' },
        lastName: { type: 'string' },
        middleName: { type: 'string' },
      },
      required: ['firstName', 'lastName', 'middleName'],
    };
    const elements = generateFilterElements(schema, {});
    // q + first 2 text = 3 total
    const nonQFilters = elements.filter((el) => el.props.source !== 'q');
    expect(nonQFilters).toHaveLength(2);
  });
});
