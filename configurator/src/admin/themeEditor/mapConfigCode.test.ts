import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mapConfigCode } from './mapConfigCode';

// ours#1685 (#707 row 42): Edit wrote code DEFAULT whatever row was edited, so a row other than DEFAULT was refused
// UNIQUE_KEY_UPDATE_ERR on every save.
describe('Map Configuration save code', () => {
  it('an edited row keeps its own code', () => {
    expect(mapConfigCode({ data: { code: 'VARIANT_B' } }, { code: 'VARIANT_B', maxZoom: 17 })).toBe('VARIANT_B');
  });
  it('an edited row keeps its code even if the form data says otherwise', () => {
    expect(mapConfigCode({ data: { code: 'VARIANT_B' } }, { code: 'DEFAULT' })).toBe('VARIANT_B');
  });
  it('a new record takes the typed code, else DEFAULT', () => {
    expect(mapConfigCode(null, { code: ' NEW_1 ' })).toBe('NEW_1');
    expect(mapConfigCode(null, {})).toBe('DEFAULT');
  });
  it('the editor writes the code from mapConfigCode, not a fixed DEFAULT', () => {
    const src = readFileSync(resolve(__dirname, 'MapConfigEditor.tsx'), 'utf8');
    expect(src).not.toMatch(/code:\s*MAP_CONFIG_KEY\s*}/);
    expect(src).not.toMatch(/mdmsCreate\(tenantId, SCHEMA, MAP_CONFIG_KEY/);
    expect(src).toMatch(/mapConfigCode\(record, data\)/);
  });
});
