// A State that drills into a fetched hierarchy one level at a time: fetch the
// current level's options, show them (with an optional breadcrumb trail), and
// on reply either descend, go back, or land on a leaf. Reuses the real
// dialog.constructListPromptAndGrammer/get_intention so numbering and grammar
// match the production walk kind exactly.
const { assign } = require('xstate');
const dialog = require('../util/dialog');
const State = require('./flow-state');

// Twilio rejects a WhatsApp body over 1600 characters (error 21617) and the citizen
// hears nothing, so a long level is paged behind "See more". The budget leaves room
// for the channel's own formatting; the option cap keeps a page readable on a phone.
const MAX_PAGE_CHARS = 1500;
const MAX_PAGE_OPTIONS = 20;

// A bare function is shorthand for { set: fn }; a step may have neither.
function normalizeOutcome(state, options) {
  if (!state) return undefined;
  if (typeof options === 'function') return { state, set: options };
  return { state, ...(options || {}) };
}

class WalkState extends State {
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
  get offsetSlot() { return this.key + 'Offset'; }
  get nextOffsetSlot() { return this.key + 'NextOffset'; }

  getPath(context) {
    return context[this.pathSlot] || [];
  }

  // The page of this level starting at `offset`: as many options as fit the budget
  // (at least one, however long), plus "See more" when any are left over or when
  // paging back round to the start. Numbering restarts at 1 on every page.
  renderPage(context, offset) {
    const { options = [], messageBundle = {} } = context[this.stepSlot] || {};
    const locale = context.user.locale;
    const goback = this.getPath(context).length > 0;
    const preamble = this.renderPreamble(context);
    const fits = (end) =>
      end - offset <= MAX_PAGE_OPTIONS &&
      (preamble + dialog.constructListPromptAndGrammer(options.slice(offset, end), messageBundle, locale, true, goback).prompt).length <= MAX_PAGE_CHARS;

    let end = Math.min(offset + 1, options.length);
    while (end < options.length && fits(end + 1)) end++;

    const paged = offset > 0 || end < options.length;
    const list = dialog.constructListPromptAndGrammer(options.slice(offset, end), messageBundle, locale, paged, goback);
    return { prompt: preamble + list.prompt, grammer: list.grammer, nextOffset: end < options.length ? end : 0 };
  }

  renderPreamble(context) {
    const { levelLabel, trailBundle } = context[this.stepSlot] || {};
    let text = this.preamble ? dialog.get_message(this.preamble, context.user.locale) : '';
    text = text.split('{{level}}').join(levelLabel || '');
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
              actions: assign((context, event) => {
                context[this.stepSlot] = event.data;
                context[this.offsetSlot] = 0;
              })
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
          entry: [
            assign((context) => {
              const page = this.renderPage(context, context[this.offsetSlot] || 0);
              context[this.grammerSlot] = page.grammer;
              context[this.nextOffsetSlot] = page.nextOffset;
              context.lastPrompt = page.prompt;
            }),
            (context) => dialog.sendMessage(context, context.lastPrompt)
          ],

          on: { USER_MESSAGE: 'process' }
        },
        process: {
          entry: assign((context, event) => {
            context.intention = dialog.get_intention(context[this.grammerSlot] || [], event, true);
          }),
          always: [
            // Ahead of the leaf check: 'more' is not in leafByCode, so on a leaf level
            // it would fall through to isLeafLevel and be filed as the complaint type.
            {
              target: 'question',
              cond: (context) => context.intention === dialog.INTENTION_MORE,
              actions: assign((context) => { context[this.offsetSlot] = context[this.nextOffsetSlot] || 0; })
            },
            {
              target: 'fetch',
              cond: (context) => context.intention === dialog.INTENTION_GOBACK,
              actions: assign((context) => { context[this.pathSlot] = this.getPath(context).slice(0, -1); })
            },
            {
              target: '#' + this.onLeaf.state.key,
              cond: (context) => {
                if (context.intention === dialog.INTENTION_UNKOWN) return false;
                const step = context[this.stepSlot] || {};
                // The picked node decides, falling back to the level default —
                // a branch can bottom out above the declared leaf depth.
                return step.leafByCode?.[context.intention] ?? step.isLeafLevel;
              },
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
