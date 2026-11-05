import { describe, it, expect, beforeEach } from 'vitest';
import { rememberLanding, takeLanding } from './afterSwitch';

// ours #1954 / #1945: a switch to a county lands on the screen it was made for, once, and only inside /manage
describe('landing after a tenant switch', () => {
  beforeEach(() => sessionStorage.clear());
  it('is consumed once', () => {
    rememberLanding('/manage/boundaries');
    expect(takeLanding()).toBe('/manage/boundaries');
    expect(takeLanding()).toBeNull();
  });
  it('honours only a /manage path', () => {
    rememberLanding('https://evil.example/');
    expect(takeLanding()).toBeNull();
    rememberLanding('/login');
    expect(takeLanding()).toBeNull();
  });
});
