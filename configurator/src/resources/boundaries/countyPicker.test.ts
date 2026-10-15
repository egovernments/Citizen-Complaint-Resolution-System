import { describe, it, expect } from 'vitest';
import { asksForCounty, enterableCounties } from './countyPicker';

// ours #1954: Boundaries at a county-layout state asks "which county?" and offers only counties the admin can enter
const COUNTIES = [{ code: 'ke.bomet', name: 'Bomet' }, { code: 'ke.nairobi', name: 'Nairobi' }];

describe('which county (boundaries at the state)', () => {
  it('asks only at a state root with counties', () => {
    expect(asksForCounty('ke', COUNTIES)).toBe(true);
    expect(asksForCounty('ke.bomet', COUNTIES)).toBe(false);
    expect(asksForCounty('ke', [])).toBe(false);
  });

  it('a role at the state covers every county; a role at one county covers that county only', () => {
    expect(enterableCounties(COUNTIES, [{ tenantId: 'ke', roles: ['ACCOUNT_ADMIN'] }])).toEqual(COUNTIES);
    expect(enterableCounties(COUNTIES, [{ tenantId: 'ke.nairobi', roles: ['ACCOUNT_ADMIN'] }])).toEqual([COUNTIES[1]]);
    expect(enterableCounties(COUNTIES, [{ tenantId: 'KE', roles: ['SUPERUSER'] }])).toEqual(COUNTIES);
  });

  it('a membership below a county, an inactive account or no roles enters none', () => {
    expect(enterableCounties(COUNTIES, [{ tenantId: 'ke.bomet.ward1', roles: ['GRO'] }])).toEqual([]);
    expect(enterableCounties(COUNTIES, [{ tenantId: 'ke', roles: ['X'], code: 'DIGIT_ACCOUNT_INACTIVE' }])).toEqual([]);
    expect(enterableCounties(COUNTIES, [{ tenantId: 'ke', roles: [] }])).toEqual([]);
  });

  it('without an identity session every county is offered (the server decides on entry)', () => {
    expect(enterableCounties(COUNTIES, null)).toEqual(COUNTIES);
  });
});
