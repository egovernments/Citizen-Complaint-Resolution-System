const DEFAULT_TTL_MS = 30 * 60 * 1000;

// This class is responsible for tracking the state of sandbox organization login flows for users based on their mobile numbers. It maintains a store of user sessions, allowing for the retrieval, updating, and deletion of session data. The class also provides methods to check if a user is waiting for email verification or organization selection, and it automatically expires stale sessions based on a specified time-to-live (TTL) value.
class SandboxOrgTracker {
  constructor(store, ttlMs = DEFAULT_TTL_MS) {
    this.store = store;
    this.ttlMs = ttlMs;
  }

  get(mobileNumber) {
    return this.store[mobileNumber];
  }

  set(mobileNumber, fields) {
    this.store[mobileNumber] = { timestamp: Date.now(), ...fields };
  }

  delete(mobileNumber) {
    delete this.store[mobileNumber];
  }

  expireIfStale(mobileNumber) {
    const entry = this.get(mobileNumber);
    if (entry && (Date.now() - entry.timestamp) > this.ttlMs) {
      this.delete(mobileNumber);
    }
  }

  isWaitingForEmail(mobileNumber) {
    const entry = this.get(mobileNumber);
    return !!(entry && entry.waitingForEmail);
  }

  isWaitingForOrgSelection(mobileNumber) {
    const entry = this.get(mobileNumber);
    return !!(entry && entry.waitingForOrgSelection);
  }

  isAuthenticated(mobileNumber) {
    const entry = this.get(mobileNumber);
    return !!(entry && entry.userId && entry.orgTenantId);
  }

  getUserId(mobileNumber) {
    const entry = this.get(mobileNumber);
    return entry && entry.userId;
  }
}

module.exports = SandboxOrgTracker;
