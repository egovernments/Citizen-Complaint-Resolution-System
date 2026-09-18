// src/machine/flow/flow-state-group.js

// A named group of states, compiled into a compound XState node — lets steps
// nest under a shared parent (e.g. onboarding) without changing the steps
// themselves. Plays the role layout.js's wrappers/place mapping plays today.
const { assign } = require('xstate');

class Group {
  // onEntry (optional): a context-mutating function run when the group is
  // entered, e.g. clearing a scratch answer bag
  constructor(key) {
    this.key = key;
    this.states = [];
    this.initialKey = undefined;
    this.onEntry = undefined;
}

  setStart(key) {
    this.initialKey = key;
    return this;
  }

  setStates(states) {
    this.states = states;
    return this;
  }

  setOnEntry(onEntry) {
    this.onEntry = onEntry;
    return this;
  }

  compileNode() {
    const config = { id: this.key, initial: this.initialKey, states: {} };
    if (this.onEntry) config.entry = assign(this.onEntry);
    for (const state of this.states) {
      config.states[state.key] = state.compileNode();
    }
    return config;
  }
}

module.exports = Group;
