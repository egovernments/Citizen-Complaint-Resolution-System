import { describe, it, expect } from 'vitest';
import { getDescriptor } from './index';
import { getGenericMdmsResources } from '../../../packages/data-provider/src/providers/resourceRegistry';

// Masters the citizen/employee apps read that had no configurator screen: dashboard packs and KPI
// definitions (employee + public dashboards), admin-console templates, user-field validation rules.
describe('dashboard / admin-console / form-validation masters', () => {
  const generic = getGenericMdmsResources();
  const cases: [string, string, string[]][] = [
    ['dashboard-packs', 'dss.DashboardPack', ['tiles', 'layout']],
    ['kpi-definitions', 'dss.KpiDefinition', ['viz', 'query', 'params']],
    ['admin-console-schema', 'CRS-ADMIN-CONSOLE.adminSchema', ['properties']],
    ['form-validations', 'common-masters.FormValidations', []],
  ];

  it.each(cases)('%s is a generic MDMS screen on %s', (name, schema) => {
    expect(generic[name]?.schema).toBe(schema);
  });

  it.each(cases)('%s: every nested field has a widget (the generic form skips objects and arrays)', (_name, schema, nested) => {
    const d = getDescriptor(schema);
    expect(d).toBeTruthy();
    for (const path of nested) {
      const spec = d!.fields.find((f) => f.path === path);
      expect(spec?.widget, `${schema}.${path}`).toMatch(/^(json|chip-array)$/);
    }
  });

  it.each(cases.slice(0, 3))('%s: the x-unique key is not editable after create', (_name, schema) => {
    const d = getDescriptor(schema)!;
    const key = schema === 'CRS-ADMIN-CONSOLE.adminSchema' ? 'title' : 'id';
    expect(d.fields.find((f) => f.path === key)?.hidden).toBe('edit');
  });
});
