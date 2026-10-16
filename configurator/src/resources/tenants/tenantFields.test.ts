import { describe, it, expect } from 'vitest';
import { formatPincodes, parsePincodes } from './tenantFields';

describe('tenant pincode field', () => {
  it('shows the stored numbers as chips', () => {
    expect(formatPincodes([20400, 20401])).toEqual(['20400', '20401']);
    expect(formatPincodes(undefined)).toEqual([]);
  });
  it('saves whole numbers only, once each (the schema is number[])', () => {
    expect(parsePincodes(['20400', ' 20401 ', '20400', 'abc', '12.5', '-1'])).toEqual([20400, 20401]);
    expect(parsePincodes(null)).toEqual([]);
  });
});
