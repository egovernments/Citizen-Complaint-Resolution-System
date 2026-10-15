import { describe, it, expect, beforeEach } from 'vitest';
import { listNotice, namesText, recordNotice, recordPath, rememberLanding, takeLanding, treeNotice } from './overrideText';

// ours #1945: a state-root record that a county overrides says so, in words a person reads once.
describe('county override notice words', () => {
  beforeEach(() => sessionStorage.clear());

  it('names the counties', () => {
    expect(namesText([{ tenantId: 'ke.bomet', name: 'Bomet' }])).toBe('Bomet');
    expect(namesText([{ tenantId: 'ke.bomet', name: 'Bomet' }, { tenantId: 'ke.nairobi', name: 'Nairobi' }])).toBe('Bomet and Nairobi');
    expect(namesText([{ tenantId: 'a', name: 'A' }, { tenantId: 'b', name: 'B' }, { tenantId: 'c', name: '' }])).toBe('A, B and c');
  });

  it('says the value is not used there', () => {
    expect(recordNotice([{ tenantId: 'ke.bomet', name: 'Bomet' }])).toBe("Overridden in Bomet: this value isn't used there.");
    expect(treeNotice([{ tenantId: 'ke.bomet', name: 'Bomet' }], 'ADMIN')).toBe("Overridden in Bomet: it uses its own ADMIN boundary tree, so changes here aren't used there.");
    expect(listNotice(1, 1)).toBe("1 of the 1 record shown is overridden in a county: that value isn't used there.");
    expect(listNotice(2, 16)).toBe("2 of the 16 records shown are overridden in a county: those values aren't used there.");
  });

  it('opens the county record after the switch, once, and only a /manage path', () => {
    expect(recordPath('pgr-escalation', { tenantId: 'ke.bomet', name: 'Bomet', uniqueIdentifier: 'DEFAULT' })).toBe('/manage/pgr-escalation/DEFAULT/show');
    rememberLanding('/manage/pgr-escalation/DEFAULT/show');
    expect(takeLanding()).toBe('/manage/pgr-escalation/DEFAULT/show');
    expect(takeLanding()).toBeNull();
    rememberLanding('https://evil.example/');
    expect(takeLanding()).toBeNull();
  });
});
