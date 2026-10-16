import { describe, it, expect } from 'vitest';
import { getDescriptor } from './index';

// The generic Edit form skips object/array fields a descriptor does not claim (MdmsResourceEdit): these masters' only
// configurable content is such fields, so without a descriptor they could not be edited (ccrs-digit3 #1255, pairs G1/G2).
const CASES: Array<[string, string[]]> = [
  ['tenant.citymodule', ['tenants']],
  ['common-masters.uiHomePage', ['appBannerDesktop', 'appBannerMobile', 'whatsAppBannerDesktop', 'whatsAppBannerMobile',
    'citizenServicesCard', 'informationAndUpdatesCard', 'whatsNewSection']],
];

describe('descriptors for masters whose content is object/array fields', () => {
  it.each(CASES)('%s claims its object/array fields as json', (schema, paths) => {
    const d = getDescriptor(schema);
    expect(d, `descriptor for ${schema}`).toBeDefined();
    for (const p of paths) expect(d!.fields.find((f) => f.path === p)?.widget, p).toBe('json');
  });

  it('leaves the identifier to the generic form (its id-immutability guard)', () => {
    expect(getDescriptor('tenant.citymodule')!.fields.map((f) => f.path)).not.toContain('code');
    expect(getDescriptor('common-masters.uiHomePage')!.fields.map((f) => f.path)).not.toContain('redirectURL');
  });
});
