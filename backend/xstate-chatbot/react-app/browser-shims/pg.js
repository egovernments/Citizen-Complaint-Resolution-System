// Browser stub for the `pg` driver.
//
// The harness bundles the real nodejs machine, and session/repo/index.js requires
// postgres-repo unconditionally, so postgres-config.js runs `new Pool()` at import
// time even though the browser always uses the in-memory repo. Without this the
// page dies on load. Anything that actually talks to Postgres throws, so a real
// query here is a bug rather than a silent no-op.
class Pool {
  on() { return this; }
  async query() { throw new Error('pg is not available in the browser harness (REPO_PROVIDER must be InMemory)'); }
  async connect() { throw new Error('pg is not available in the browser harness (REPO_PROVIDER must be InMemory)'); }
  async end() {}
}

module.exports = { Pool, Client: Pool };
