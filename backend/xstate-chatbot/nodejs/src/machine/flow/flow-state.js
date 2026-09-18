// One node in a citizen conversation flow: what message it sends on entry,
// and (via branches) which state comes next. compileNode() turns it into an
// XState node; subclasses (QuestionState, ProcessingState) override it for
// question-and-wait and async-call behavior.
const { assign } = require('xstate');
const dialog = require('../util/dialog');

class State {
  constructor(key) {
    this.key = key;
    this.prompt = null;
    this.branches = [];
  }

  // sets the message sent to the citizen when this state is entered
  setPrompt(prompt) {
    this.prompt = prompt;
    return this;
  }

  // sets the state to go to next, unconditionally; set (optional) writes to context
  setNext(state, set) {
    this.branches.push({ cond: null, state, set });
    return this;
  }

  // adds a guarded transition to the next state when cond is true; set (optional)
  // writes to context. Chain multiple times for 3+ branches, then close with setNext.
  setConditionalNext(state, cond, set) {
    this.branches.push({ cond, state, set });
    return this;
  }

  // sets template values injected into the prompt (e.g. {{name}} -> fill.name)
  setFill(fill) {
    this.fill = fill;
    return this;
  }

  // sets a side effect run on entry, alongside the prompt (doesn't affect branching)
  setEffect(fn) {
    this.effect = fn;
    return this;
  }


  
  // renders a bundle's localized text with template tokens filled in. Each
  // fill value may be a function(context, event), a locale bundle object
  // (resolved via get_message), or a plain value.
  renderText(bundle, fill, context, event) {
    let text = dialog.get_message(bundle, context.user.locale);
    for (const token of Object.keys(fill || {})) {
      const marker = `{{${token}}}`;
      if (!text.includes(marker)) continue;

      const raw = fill[token];
      const value = typeof raw === 'function'
        ? raw(context, event)
        : (raw && typeof raw === 'object' ? dialog.get_message(raw, context.user.locale) : raw);
      text = text.split(marker).join(String(value ?? ''));
    }
    return text;
  }

  // sends the prompt's localized text to the citizen. this.prompt may be a
  // single bundle, or an array of {bundle, delay, immediate} for multiple
  // staggered messages. Template tokens filled from this.fill plus extraFill.
  enter(context, extraFill, event) {
    if (!this.prompt) return;

    const items = Array.isArray(this.prompt) ? this.prompt : [{ bundle: this.prompt }];

    for (const item of items) {
      const send = () => {
        const fill = { ...this.fill, ...extraFill };
        const text = this.renderText(item.bundle, fill, context, event);
        context.lastPrompt = text;
        dialog.sendMessage(context, text, item.immediate !== false);
      };


      if (item.delay)
        setTimeout(send, item.delay);
      else
        send();
    }
  }


  // builds the guarded transitions array for this state's branches, targeting by
  // absolute id so nested (question/process) states can reach top-level siblings
  resolveBranches() {
    return this.branches.map((branch) => ({
      target: '#' + branch.state.key,
      cond: branch.cond || undefined,
      ...(branch.set ? { actions: assign(branch.set) } : {})
    }));
  }

  // compiles this state into its XState node shape
    compileNode() {
    return {
      id: this.key,
      entry: (context, event) => {
        this.enter(context);
        if (this.effect) this.effect(context, event);
      },
      always: this.resolveBranches()
    };
  }

}

module.exports = State;
