// A State that sends nothing and waits for exactly one reply before
// branching — unlike the base State (branches immediately) or QuestionState
// (sends a prompt first). Matches the real "gate" kind used by the chassis's
// start step.
const State = require('./flow-state');

class GateState extends State {
  compileNode() {
    return {
      id: this.key,
      on: { USER_MESSAGE: this.resolveBranches() }
    };
  }
}

module.exports = GateState;
