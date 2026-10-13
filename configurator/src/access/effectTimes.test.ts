import { EFFECT, whenItApplies, whenItAppliesAll } from './effectTimes';

describe('when it applies (one config, measured values)', () => {
  it('says each kind plainly, from the config', () => {
    expect(whenItApplies('areas')).toBe("Area changes apply to the person's searches about 30 seconds.");
    expect(whenItApplies('calls')).toMatch(/^What the role may do applies within 6 minutes .* Menus and buttons update when the person reloads the page; no sign-out needed\.$/);
    expect(whenItApplies('scope')).toMatch(/within 15 minutes/);
    expect(whenItApplies('grant')).toMatch(/next sign-in, or within 15 minutes when their session refreshes/);
  });
  it('the sentences follow the numbers (a shorter gateway cache changes the text, nothing else)', () => {
    const was = EFFECT.gatewaySeconds;
    try {
      EFFECT.gatewaySeconds = 60;
      expect(whenItApplies('calls')).toMatch(/^What the role may do applies about 60 seconds/);
    } finally { EFFECT.gatewaySeconds = was; }
  });
  it('a save lists each kind it touches once, in a fixed order', () => {
    expect(whenItAppliesAll(['fields', 'calls', 'fields', 'workflow'])).toEqual([whenItApplies('calls'), whenItApplies('fields'), whenItApplies('workflow')]);
  });
});
