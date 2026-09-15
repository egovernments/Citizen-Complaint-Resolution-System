import { RateLimiter } from './rate-limiter';

describe('RateLimiter', () => {
  it('allows up to the limit per window, then says how long to wait', () => {
    let t = 0;
    const rl = new RateLimiter(3, 60_000, () => t);
    expect([rl.tryTake(), rl.tryTake(), rl.tryTake()]).toEqual([0, 0, 0]);
    t = 10_000;
    expect(rl.tryTake()).toBe(50); // the first call (t=0) leaves the window at 60s
    t = 60_000;
    expect(rl.tryTake()).toBe(0);
  });

  it('reserves several calls all-or-nothing', () => {
    const rl = new RateLimiter(5, 60_000, () => 0);
    expect(rl.tryTake(4)).toBe(0);
    expect(rl.tryTake(2)).toBeGreaterThan(0);
    expect(rl.tryTake(1)).toBe(0);
  });

  it('is off at 0', () => {
    const rl = new RateLimiter(0);
    for (let i = 0; i < 1000; i++) expect(rl.tryTake()).toBe(0);
  });
});
