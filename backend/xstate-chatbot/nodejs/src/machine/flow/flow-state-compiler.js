// Compiles a State graph into an XState machine config.
function compile(states, initialKey) {
  const config = { initial: initialKey, states: {} };

  for (const state of states) {
    config.states[state.key] = state.compileNode();
  }

  return config;
}

module.exports = compile;
