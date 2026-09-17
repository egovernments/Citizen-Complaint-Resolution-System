// A State that captures free-text or media input: sends the prompt, waits for
// a reply, checks it matches the expected type (accept), validates it, writes
// it into context if valid, retries otherwise.
const { assign } = require('xstate');
const dialog = require('../util/dialog');
const State = require('./flow-state');

class AskState extends State {
  // validates the raw reply; return true if valid, or a string/bundle to show
  // as a custom retry message. Defaults to always valid.
  setValidate(fn) {
    this.validate = fn;
    return this;
  }

  // writes the valid reply into context, before branching
  setOnValid(fn) {
    this.onValid = fn;
    return this;
  }

  // overrides the default "invalid" message shown when validate returns false
  setRetryMessage(prompt) {
    this.retryPrompt = prompt;
    return this;
  }

  // sets the expected reply type(s), e.g. 'text' (default) or ['image', 'document']
  setAccept(accept) {
    this.accept = accept;
    return this;
  }

  // if true, a literal "1" reply counts as valid even when accept doesn't
  // match — lets a media prompt be explicitly skipped
  setOptional(optional) {
    this.optional = optional;
    return this;
  }

  get validSlot() { return this.key + 'Valid'; }
  get retryMessageSlot() { return this.key + 'RetryMessage'; }

  compileNode() {
    return {
      id: this.key,
      initial: 'question',
      states: {
        question: {
          entry: (context) => this.enter(context),
          on: { USER_MESSAGE: 'process' }
        },
        process: {
          entry: assign((context, event) => {
            if (!dialog.validateInputType(event, this.accept || 'text')) {
              context[this.validSlot] = !!(this.optional && String(event.message?.input ?? '') === '1');
              context[this.retryMessageSlot] = undefined;
              return;
            }
            const isMedia = Array.isArray(this.accept);
            const input = isMedia ? event.message.input : String(event.message.input).trim();
            const verdict = this.validate ? this.validate(input) : true;
            context[this.validSlot] = verdict === true;
            context[this.retryMessageSlot] = verdict === true ? undefined : verdict;
            if (verdict === true && this.onValid) this.onValid(context, input);
          }),
          always: [
            { target: 'retry', cond: (context) => !context[this.validSlot] },
            ...this.resolveBranches()
          ]
        },
        retry: {
          entry: (context) => {
            const bundle = context[this.retryMessageSlot] || this.retryPrompt || dialog.global_messages.error.retry;
            const text = typeof bundle === 'string' ? bundle : this.renderText(bundle, this.fill, context);
            dialog.sendMessage(context, text);
          },
          always: 'question'
        }
      }
    };
  }
}

module.exports = AskState;
