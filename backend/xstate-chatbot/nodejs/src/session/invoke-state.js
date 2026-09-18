const config = require("../env-variables");

/**
 * True while a state has an invoked service running.
 *
 * Restoring such a state re-executes the invocation: xstate v4's
 * interpret().start(savedState) replays the `xstate.start` action for every
 * invocation in the configuration (verified on 4.38.3 — restoring an
 * invoke-active snapshot ran the service twice). For persistComplaint that means
 * a SECOND PGR complaint, so these states must never be persisted and the
 * dispatch lock must not be released while one is in flight.
 */
function hasActiveInvoke(state) {
  return state.configuration.some((node) => node.invoke && node.invoke.length > 0);
}

/**
 * Resolves once the interpreter reaches a state with no invocation in flight (or
 * is done). Capped by dispatchSettleTimeoutMs so a hung HTTP call cannot hold a
 * citizen's dispatch lock forever.
 */
function waitUntilSettled(service) {
  if (service.state.done || !hasActiveInvoke(service.state)) return Promise.resolve();

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      console.warn(`Dispatch settle timeout after ${config.dispatchSettleTimeoutMs}ms; releasing the lock`);
      done();
    }, config.dispatchSettleTimeoutMs);

    const subscription = service.subscribe((state) => {
      if (state.done || !hasActiveInvoke(state)) done();
    });

    function done() {
      clearTimeout(timer);
      subscription.unsubscribe();
      resolve();
    }
  });
}

module.exports = { hasActiveInvoke, waitUntilSettled };
