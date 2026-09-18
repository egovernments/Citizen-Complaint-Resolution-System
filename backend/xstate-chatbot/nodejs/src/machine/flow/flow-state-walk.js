// A State that drills into a fetched hierarchy one level at a time: fetch the
// current level's options, show them (with an optional breadcrumb trail), and
// on reply either descend, go back, or land on a leaf. Reuses the real
// dialog.constructListPromptAndGrammer/get_intention so numbering and grammar
// match the production walk kind exactly.
const { assign } = require('xstate');
const dialog = require('../util/dialog');
const State = require('./flow-state');

// A bare function is shorthand for { set: fn }; a step may have neither.
function normalizeOutcome(state, options) {
  if (!state) return undefined;
  if (typeof options === 'function') return { state, set: options };
  return { state, ...(options || {}) };
}

class WalkState extends State {
  // async fn(context, path) -> {options, messageBundle, trailBundle, levelLabel, isLeafLevel}
  setFetch(fn) {
    this.fetch = fn;
    return this;
  }

  // sets where to go if the fetch's promise rejects. Defaults to
  // #system_error, matching the real walk kind's default.
  setOnError(state) {
    this.onError = state;
    return this;
  }

  // state (and optional {slot, set}) to use when a fetch returns no options.
  // slot, if given, is written with the parent level's code (the last path
  // element) — there was no reply to record, this is an automatic escape.
  // onEmpty is optional; some walks (e.g. complaintType2Step) don't have one.
  setOnEmpty(state, options) {
    this.onEmpty = normalizeOutcome(state, options);
    return this;
  }

  // state (and optional {slot, set}) to use once a leaf option is picked.
  // slot, if given, is written with the matched leaf code.
  setOnLeaf(state, options) {
    this.onLeaf = normalizeOutcome(state, options);
    return this;
  }

  // the breadcrumb-line template shown above the list (may contain a {{level}} token)
  setPreamble(bundle) {
    this.preamble = bundle;
    return this;
  }

  // if true, prepends the walked path as a breadcrumb trail above the preamble
  setTrail(trail) {
    this.trail = trail;
    return this;
  }

  // overrides the default "invalid option" message sent on an unrecognized reply
  setRetryMessage(prompt) {
    this.retryPrompt = prompt;
    return this;
  }

  get pathSlot() { return this.key + 'Path'; }
  get stepSlot() { return this.key + 'Step'; }
  get grammerSlot() { return this.key + 'Grammer'; }

  getPath(context) {
    return context[this.pathSlot] || [];
  }

  renderPreamble(context) {
    const { levelLabel, trailBundle } = context[this.stepSlot] || {};
    let text = this.preamble ? dialog.get_message(this.preamble, context.user.locale) : '';
    text = text.replace('{{level}}', levelLabel || '');
    if (this.trail) {
      const trail = this.getPath(context)
        .map((code) => (trailBundle && trailBundle[code] ? dialog.get_message(trailBundle[code], context.user.locale) : code))
        .join(' › ');
      if (trail) text = `*${trail}*\n${text}`;
    }
    return text;
  }

  compileNode() {
    return {
      id: this.key,
      initial: 'fetch',
      states: {
        fetch: {
          invoke: {
            src: (context) => this.fetch(context, this.getPath(context)),
            onDone: {
              target: 'evaluate',
              actions: assign((context, event) => { context[this.stepSlot] = event.data; })
            },
            onError: { target: this.onError ? '#' + this.onError.key : '#system_error' }
          }
        },
        evaluate: {
          always: this.onEmpty ? [
            {
              target: '#' + this.onEmpty.state.key,
              cond: (context) => ((context[this.stepSlot] || {}).options || []).length === 0,
              actions: assign((context) => {
                if (this.onEmpty.slot) context.slots.pgr[this.onEmpty.slot] = this.getPath(context)[this.getPath(context).length - 1];
                if (this.onEmpty.set) this.onEmpty.set(context);
              })
            },
            { target: 'question' }
          ] : [{ target: 'question' }]
        },
        question: {
          entry: assign((context) => {
            const { options, messageBundle } = context[this.stepSlot] || {};
            const goback = this.getPath(context).length > 0;
            const list = dialog.constructListPromptAndGrammer(options || [], messageBundle || {}, context.user.locale, false, goback);
            context[this.grammerSlot] = list.grammer;
            context.lastPrompt = this.renderPreamble(context) + list.prompt;
            dialog.sendMessage(context, context.lastPrompt);
          }),
          on: { USER_MESSAGE: 'process' }
        },
        process: {
          entry: assign((context, event) => {
            context.intention = dialog.get_intention(context[this.grammerSlot] || [], event, true);
          }),
          always: [
            {
              target: 'fetch',
              cond: (context) => context.intention === dialog.INTENTION_GOBACK,
              actions: assign((context) => { context[this.pathSlot] = this.getPath(context).slice(0, -1); })
            },
            {
              target: '#' + this.onLeaf.state.key,
              cond: (context) => context.intention !== dialog.INTENTION_UNKOWN && (context[this.stepSlot] || {}).isLeafLevel,
              actions: assign((context) => {
                if (this.onLeaf.slot) context.slots.pgr[this.onLeaf.slot] = context.intention;
                context[this.pathSlot] = [...this.getPath(context), context.intention];
                if (this.onLeaf.set) this.onLeaf.set(context);
              })
            },
            {
              target: 'fetch',
              cond: (context) => context.intention !== dialog.INTENTION_UNKOWN,
              actions: assign((context) => { context[this.pathSlot] = [...this.getPath(context), context.intention]; })
            },
            { target: 'retry' }
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

module.exports = WalkState;
