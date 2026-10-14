import { describe, expect, it } from 'vitest';
import { matchPeople, named } from './peopleNames';

// cfgreview F14 (#1560): names instead of codes, find a person by name or mobile.
describe('Roles by tenant names', () => {
  it('shows the name with the code second', () => {
    const m = new Map([['GRO', 'Grievance Routing Officer'], ['X', 'X']]);
    expect(named(m, 'GRO')).toBe('Grievance Routing Officer (GRO)');
    expect(named(m, 'X')).toBe('X');
    expect(named(m, 'NOPE')).toBe('NOPE');
  });
  it('finds by employee code, else by name or mobile', () => {
    const emps = [
      { code: 'EMP-1', user: { name: 'Jane Chebet', mobileNumber: '712345678' } },
      { code: 'EMP-2', user: { name: 'John Kiprono', mobileNumber: '799000111' } },
      { code: 'EMP-3', isActive: false, user: { name: 'Jane Old' } },
    ];
    expect(matchPeople(emps, 'emp-2').map((e) => e.code)).toEqual(['EMP-2']);
    expect(matchPeople(emps, 'jane').map((e) => e.code)).toEqual(['EMP-1']);
    expect(matchPeople(emps, '712345').map((e) => e.code)).toEqual(['EMP-1']);
    expect(matchPeople(emps, '  ')).toEqual([]);
  });
});
