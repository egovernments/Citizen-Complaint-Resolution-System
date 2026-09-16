import { describe, it, expect } from 'vitest';
import * as v from './validation';

/**
 * Date of Birth and Date of Appointment must NOT be mandatory on the Employee
 * create screen (egovernments/CCRS#1949). The Edit screen has always let an
 * operator clear both and save, so requiring them on Create only made the two
 * screens disagree.
 *
 * `DigitFormInput` renders the red asterisk from ra-core's
 * `useInput().isRequired`, which ra-core derives from `validate.isRequired`.
 * Asserting the flag here is what pins the asterisk's absence.
 */
describe('Employee date validators are optional (egovernments/CCRS#1949)', () => {
  it('exposes no `dobRequired` validator', () => {
    expect('dobRequired' in v).toBe(false);
  });

  it('dateInPast is not flagged required, so no asterisk is rendered', () => {
    expect((v.dateInPast as unknown as { isRequired?: boolean }).isRequired).toBeFalsy();
  });

  it.each([undefined, null, ''])('dateInPast accepts the empty value %p', (value) => {
    expect(v.dateInPast(value)).toBeUndefined();
  });

  it('dateInPast still rejects today and any future date', () => {
    const today = new Date();
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const tomorrow = new Date(today.getTime() + 86_400_000);

    expect(v.dateInPast(iso(today))).toBe('Date must be in the past');
    expect(v.dateInPast(iso(tomorrow))).toBe('Date must be in the past');
  });

  it('dateInPast still accepts a real past date', () => {
    expect(v.dateInPast('1990-05-14')).toBeUndefined();
  });

  // The other composed validators keep their asterisk — this change is scoped
  // to the two date fields.
  it('leaves the remaining required validators flagged', () => {
    for (const key of ['name', 'mobileRequired', 'emailRequired', 'codeRequired'] as const) {
      expect((v[key] as unknown as { isRequired?: boolean }).isRequired).toBe(true);
    }
  });
});
