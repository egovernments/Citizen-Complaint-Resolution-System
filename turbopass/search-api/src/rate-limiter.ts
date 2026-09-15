// Caps calls per rolling window across ALL callers.
//
// A central turbopass holds the project's Geoapify key; without a cap any page
// that can reach it can spend that key's quota. A per-caller limit would need a
// client IP we can trust, which a proxied deployment doesn't give us — and the
// bill is global anyway, so the cap is too.
export class RateLimiter {
  private readonly stamps: number[] = [];

  constructor(
    private readonly limit: number,
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Reserves `n` calls. Returns 0 when reserved, else seconds until there is room. */
  tryTake(n = 1): number {
    if (this.limit <= 0) return 0; // 0 disables the cap
    const t = this.now();
    while (this.stamps.length && this.stamps[0] <= t - this.windowMs) {
      this.stamps.shift();
    }
    const excess = this.stamps.length + n - this.limit;
    if (excess > 0) {
      const unlocksAt = this.stamps[excess - 1];
      if (unlocksAt === undefined) return Math.ceil(this.windowMs / 1000);
      return Math.max(1, Math.ceil((unlocksAt + this.windowMs - t) / 1000));
    }
    for (let i = 0; i < n; i++) this.stamps.push(t);
    return 0;
  }
}
