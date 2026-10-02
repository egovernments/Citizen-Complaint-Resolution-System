// Transition writes, chained per citizen.
//
// onTransition fires several times for one inbound event, and each write used to
// be an independent async IIFE — so two writes could land out of order and leave
// an older state as the stored one. Chaining also gives dispatch something to
// await, so the next queued message cannot read a state that is still being
// written.
//
// A failed write does not stop the writes queued behind it, but it is remembered
// and pendingPersist rejects with it: resolving would release the per-citizen lock
// and let the next message load the stale row and apply its answer to the wrong step.
const { ExternalServiceError } = require('./errors');

const queues = new Map();
const failures = new Map();

function enqueuePersist(userId, work) {
  const previous = queues.get(userId) || Promise.resolve();

  const current = previous
    .catch(() => {}) // a failed write must not block the next transition
    .then(work)
    .catch((error) => {
      console.error(`Failed to persist transition for ${userId}: ${error.message}`);
      if (!failures.has(userId)) failures.set(userId, error);
    })
    .finally(() => {
      // identity-guarded: a write queued meanwhile is the tail now and must stay
      if (queues.get(userId) === current) queues.delete(userId);
    });

  queues.set(userId, current);
  return current;
}

/** Resolves once every write queued for this citizen has landed; rejects if any failed. */
async function pendingPersist(userId) {
  await (queues.get(userId) || Promise.resolve());
  const error = failures.get(userId);
  if (!error) return;
  failures.delete(userId);
  throw new ExternalServiceError(`Conversation state for ${userId} was not saved: ${error.message}`);
}

module.exports = { enqueuePersist, pendingPersist };
