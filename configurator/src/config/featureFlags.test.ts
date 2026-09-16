import { describe, expect, it } from 'vitest';
import { isEnabledFlag } from '../../../ui-shared/featureFlags';

describe('isEnabledFlag', () => {
  it.each(['1', 'true', 'TRUE', ' yes ', 'On'])('enables the explicit value %s', (value) => {
    expect(isEnabledFlag(value)).toBe(true);
  });

  it.each([undefined, null, '', '0', 'false', 'no', 'enabled', true])(
    'fails closed for %s',
    (value) => {
      expect(isEnabledFlag(value)).toBe(false);
    },
  );
});
