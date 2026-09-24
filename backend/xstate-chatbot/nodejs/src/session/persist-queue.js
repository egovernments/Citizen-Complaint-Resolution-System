// Transition writes, chained per citizen.
//
// onTransition fires several times for one inbound event, and each write used to
// be an independent async IIFE — so two writes could land out of order and leave
// an older state as the stored one. Chaining also gives dispatch something to
// await, so the next queued message cannot read a state that is still being
// written.
const queues = new Map();

function enqueuePersist(userId, work) {
  const previous = queues.get(userId) || Promise.resolve();

  const current = previous
    .catch(() => {}) // a failed write must not block the next transition
    .then(work)
    .catch((error) => console.error(`Failed to persist transition for ${userId}: ${error.message}`))
    .finally(() => {
      // identity-guarded: a write queued meanwhile is the tail now and must stay
      if (queues.get(userId) === current) queues.delete(userId);
    });

  queues.set(userId, current);
  return current;
}

/** Resolves once every write queued for this citizen has landed. */
function pendingPersist(userId) {
  return queues.get(userId) || Promise.resolve();
}

module.exports = { enqueuePersist, pendingPersist };
