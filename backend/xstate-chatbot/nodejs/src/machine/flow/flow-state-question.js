// A State that asks the citizen something and waits for their reply before
// branching: sends the prompt, waits for USER_MESSAGE, matches the reply
// against its options, then resolves the next state via the base class's branches.
// Options may be a static array or a function (called with context) for a
// runtime-computed list (e.g. offeredLocales()) — either way the resolved list
// is stored in context so a persisted/resumed session sees the same list it
// was shown, not a freshly recomputed one.
const { assign } = require('xstate');
const dialog = require('../util/dialog');
const State = require('./flow-state');

class QuestionState extends State {
  // stores the choices this state offers: a static array (plain strings or
  // {value, label} objects), or a function(context) returning either
  setOptions(options) {
    this.options = options;
    return this;
  }

  // overrides the default "invalid option" message sent on an unrecognized reply
  setRetryMessage(prompt) {
    this.retryPrompt = prompt;
    return this;
  }

  // sets the state (and write) to use when the reply is unrecognized, instead
  // of retrying — e.g. defaulting a locale rather than re-asking
  setOnUnknown(state, set) {
    this.onUnknown = { state, set };
    return this;
  }


  get optionsSlot() { return this.key + 'Options'; }

  resolveOptions(context) {
    return typeof this.options === 'function' ? this.options(context) : (this.options || []);
  }

  renderOptionsList(options) {
    return options.map((option, i) => `*${i + 1}.* ${typeof option === 'object' ? option.label : option}`).join('\n');
  }

  // matches the reply against the resolved options stored in context (by number
  // or case-insensitive text), returning the plain value (unwrapped from
  // {value, label} if needed) so context.intention is always a plain value
  matchReply(context, event) {
    const options = context[this.optionsSlot] || [];
    const input = String(event.message.input).trim().toLowerCase();
    const index = parseInt(input, 10);
    const match = options.find((option, i) => {
      const value = typeof option === 'object' ? option.value : option;
      return i + 1 === index || String(value).toLowerCase() === input;
    });
    if (!match) return null;
    return typeof match === 'object' ? match.value : match;
  }

  compileNode() {
    return {
      id: this.key,
      initial: 'question',
      states: {
        question: {
          entry: [
            assign((context) => { context[this.optionsSlot] = this.resolveOptions(context); }),
            (context) => this.enter(context, { options: () => this.renderOptionsList(context[this.optionsSlot] || []) })
          ],
          on: { USER_MESSAGE: 'process' }
        },
        process: {
          entry: assign((context, event) => {
            context.intention = this.matchReply(context, event);
          }),
          always: [
            { target: 'retry', cond: (context) => context.intention === null && !this.onUnknown },
            ...(this.onUnknown ? [{
              target: '#' + this.onUnknown.state.key,
              cond: (context) => context.intention === null,
              ...(this.onUnknown.set ? { actions: assign(this.onUnknown.set) } : {})
            }] : []),
            ...this.resolveBranches()
          ]
        },
        retry: {
          entry: (context) => {
            const text = dialog.get_message(this.retryPrompt || dialog.global_messages.error.retry, context.user.locale);
            dialog.sendMessage(context, text);
          },
          always: 'question'
        }

      }
    };
  }
}

module.exports = QuestionState;
