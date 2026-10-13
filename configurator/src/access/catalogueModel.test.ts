import { engineFieldsUnchanged, usedBy, withPickerFields, type AttrRow } from './catalogueModel';

// the seeded locality row (default-data-handler ACCESSCONTROL-RESOURCE.attributes)
const LOCALITY: AttrRow = { resource: 'complaint', attribute: 'locality', field: 'address.locality.code', operators: ['in'], columns: { search: 'ads.locality', analytics: 'ward_code' } };
const SCOPE = { roleScopes: { GRO: { department: 'OWN', jurisdiction: 'OWN' }, SUPERVISOR: { department: 'OWN', jurisdiction: 'ALL' }, SUBCOUNTY_GRO: { department: 'ALL', jurisdiction: 'OWN' } }, default: { department: 'OWN', jurisdiction: 'OWN' } };

describe('attributes catalogue', () => {
  it('used by: the roles whose scope filters by it', () => {
    expect(usedBy('locality', SCOPE).roles).toEqual(['GRO', 'SUBCOUNTY_GRO']);
    expect(usedBy('department', SCOPE).roles).toEqual(['GRO', 'SUPERVISOR']);
    expect(usedBy('locality', SCOPE).note).toContain('every role the scope does not name');
    expect(usedBy('tenant', SCOPE).note).toMatch(/every role/);
    expect(usedBy('service_request_id', SCOPE).note).toBe('not used yet');
  });
  it('edits only the picker fields; the engine fields stay byte-identical', () => {
    const after = withPickerFields(LOCALITY, { label: ' Area ', valueSource: 'boundary-tree', conditionVar: 'resource.complaint.boundary', personMatch: 'user.attributes.jurisdictions' });
    expect(after).toEqual({ ...LOCALITY, label: 'Area', valueSource: 'boundary-tree', conditionVar: 'resource.complaint.boundary', personMatch: 'user.attributes.jurisdictions' });
    expect(engineFieldsUnchanged(LOCALITY, after)).toBe(true);
    expect(LOCALITY).not.toHaveProperty('label');
    expect(withPickerFields(after, { label: '' })).not.toHaveProperty('label');
  });
  it('refuses values the master\'s schema refuses', () => {
    expect(() => withPickerFields(LOCALITY, { valueSource: 'anything' })).toThrow(/valueSource/);
    expect(() => withPickerFields(LOCALITY, { conditionVar: 'complaint.boundary' })).toThrow(/conditionVar/);
    expect(() => withPickerFields(LOCALITY, { personMatch: 'resource.complaint.x' })).toThrow(/personMatch/);
  });
});
