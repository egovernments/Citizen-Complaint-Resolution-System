/**
 * Per-key cache with a time limit. Stores the in-flight promise, so callers
 * racing on a cold key share one load; a rejected load is evicted rather than
 * cached.
 */
class TtlCache {
  constructor(ttlMs) {
    // A missing ttl would make every expiry NaN, so every lookup misses and the
    // cache quietly does nothing. Loud, because that is invisible in a test.
    if (!(ttlMs > 0)) throw new Error(`TtlCache needs a positive ttlMs, got ${ttlMs}`);
    this.ttlMs = ttlMs;
    this.entries = new Map();
  }

  get(key, load) {
    const hit = this.entries.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.promise;

    const promise = load();
    const entry = { promise, expiresAt: Date.now() + this.ttlMs };
    this.entries.set(key, entry);
    promise.catch(() => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
    });
    return promise;
  }

  clear() {
    this.entries.clear();
  }
}

module.exports = TtlCache;
