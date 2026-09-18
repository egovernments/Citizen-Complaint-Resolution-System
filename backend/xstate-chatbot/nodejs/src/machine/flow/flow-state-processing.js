// A State that runs an async operation on entry (e.g. calling a backend
// service) and branches on whether it resolves or rejects — no prompt,
// no waiting on the citizen. A branch may also send an outcome-specific
// message (e.g. "your complaint has been filed, receipt #...").
const { assign } = require('xstate');
const dialog = require('../util/dialog');
const State = require('./flow-state');

class ProcessingState extends State {
  // stores the async function to run when this state is entered
  setProcessing(fn) {
    this.processing = fn;
    return this;
  }

  // sets where to go if the processing function's promise rejects.
  // Defaults to #system_error, matching the real call kind's default.
  setOnError(state) {
    this.onError = state;
    return this;
  }

  // attaches an outcome message (bundle, or a function(context, event)
  // returning text) to the branch just added via setNext/setConditionalNext —
  // keyed to that specific branch, not its target, since two outcomes can
  // share a target but still need different messages (e.g. trackComplaint's
  // hasRecords/noRecords both go to endstate)
  setOutcomeMessage(message, fill) {
    const branch = this.branches[this.branches.length - 1];
    if (branch) {
      branch.message = message;
      branch.fill = fill;
    }
    return this;
  }

  compileNode() {
    return {
      id: this.key,
      invoke: {
        src: (context, event) => this.processing(context, event),
        onDone: this.branches.map((branch) => ({
          target: '#' + branch.state.key,
          cond: branch.cond || undefined,
          actions: assign((context, event) => {
            if (branch.message) {
              const text = typeof branch.message === 'function'
                ? branch.message(context, event)
                : this.renderText(branch.message, branch.fill, context, event);
              dialog.sendMessage(context, text);
            }
            if (branch.set) branch.set(context, event);
          })
        })),
        onError: { target: this.onError ? '#' + this.onError.key : '#system_error' }
      }
    };
  }
}

module.exports = ProcessingState;
