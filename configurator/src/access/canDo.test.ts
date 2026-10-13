import { describe, it, expect } from 'vitest';
import { canDoByRole } from './canDo';

const actions = [
  { id: 1, url: '/pgr-services/v2/request/_search' },
  { id: 2, url: '/pgr-services/v2/request/_count' },
  { id: 3, url: '/pgr-services/v2/request/_update' },
  { id: 4, url: '/pgr-services/v2/request/_create' },
];

describe('canDoByRole (the role list\'s Can do column)', () => {
  it('names the capabilities a role holds, as the Role editor counts them', () => {
    const m = canDoByRole(actions, [
      { rolecode: 'GRO', actionid: 1 }, { rolecode: 'GRO', actionid: 2 }, { rolecode: 'GRO', actionid: 3 },
      { rolecode: 'CSR', actionid: 4 }, { rolecode: 'CSR', actionid: 1 },
    ]);
    expect(m.get('GRO')).toEqual(['View', 'Act']);
    expect(m.get('CSR')).toEqual(['View (part)', 'File']);
  });

  it('ignores inactive grants and rows without a role or action id', () => {
    const m = canDoByRole(actions, [{ rolecode: 'X', actionid: 3, active: false }, { actionid: 3 }, { rolecode: 'Y', actionid: 'n/a' }]);
    expect(m.get('X')).toBeUndefined();
    expect(m.size).toBe(0);
  });
});
