// Compiles a State graph into an XState machine config.
function compile(states, initialKey) {
  const config = { initial: initialKey, states: {} };

  for (const state of states) {
    if (config.states[state.key]) throw new Error(`duplicate state key: ${state.key}`);
    config.states[state.key] = state.compileNode();
  }

  return config;
}

module.exports = compile;
