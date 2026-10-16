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
 * is done). Capped by timeouts.dispatchSettle so a hung HTTP call cannot hold a
 * citizen's dispatch lock forever.
 *
 * Resolves true when the machine settled on its own, false when the cap fired.
 * On the cap the interpreter is STOPPED: past that point the invocation is
 * unsupervised, and leaving it running lets a late resolution drive a
 * transition — and a persist — for a citizen whose turn is already over.
 */
function waitUntilSettled(service) {
  if (service.state.done || !hasActiveInvoke(service.state)) return Promise.resolve(true);

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      console.warn(`Dispatch settle timeout after ${config.timeouts.dispatchSettle}ms; stopping the machine`);
      done(false);
      service.stop();
    }, config.timeouts.dispatchSettle);

    const subscription = service.subscribe((state) => {
      if (state.done || !hasActiveInvoke(state)) done(true);
    });

    function done(settled) {
      clearTimeout(timer);
      subscription.unsubscribe();
      resolve(settled);
    }
  });
}

module.exports = { hasActiveInvoke, waitUntilSettled };
