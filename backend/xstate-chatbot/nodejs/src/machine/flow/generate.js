const { assign } = require('xstate');
const dialog = require('../util/dialog');

const REPLY_TYPES = ['text', 'button'];

function resolve(value, context, event) {
  if (typeof value === 'function') return value(context, event);
  if (value && typeof value === 'object') return dialog.get_message(value, context.user.locale);
  return value;
}

function render(bundle, fill, context, event) {
  let text = dialog.get_message(bundle, context.user.locale);
  for (const token of Object.keys(fill || {})) {
    const marker = `{{${token}}}`;
    if (!text.includes(marker)) continue;
    text = text.split(marker).join(String(resolve(fill[token], context, event) ?? ''));
  }
  return text;
}

function emit(context, text, immediate = true, delay = 0) {
  if (!delay) return dialog.sendMessage(context, text, immediate);
  setTimeout(() => dialog.sendMessage(context, text, immediate), delay);
}

function node(step, states) {
  return { id: step.id || step.key, initial: 'question', states };
}

function promptList(step) {
  if (Array.isArray(step.prompt)) return step.prompt;
  return [{ bundle: step.prompt, delay: step.delay }];
}

function sendPrompts(step, context, event) {
  const fill = step.options
    ? { options: () => renderOptions(optionsOf(step)), ...step.fill }
    : step.fill;
  for (const item of promptList(step)) {
    emit(context, render(item.bundle, fill, context, event), item.immediate !== false, item.delay || 0);
  }
}

function questionState(step, prepare) {
  return {
    onEntry: assign((context, event) => {
      if (prepare) prepare(context);
      sendPrompts(step, context, event);
    }),
    on: { USER_MESSAGE: 'process' }
  };
}

function errorState(step, pick) {
  return {
    onEntry: assign((context) => {
      const bundle = pick(context) || step.retry || dialog.global_messages.error.retry;
      emit(context, render(bundle, step.fill, context), false);
    }),
    always: 'question'
  };
}

function branch(value) {
  return typeof value === 'string' ? { to: value } : value;
}

// Step data names other steps by key. This maps a key (or a group name, or a
// name declared outside the generator) to the '#id' xstate needs, and throws on
// anything it does not recognise — a typo fails at require time, phrased in the
// author's own vocabulary rather than as an xstate target.
function buildTargets(steps, layout) {
  const table = {};
  for (const step of steps) table[step.key] = '#' + (step.id || step.key);
  for (const dotted of Object.keys(layout.wrappers || {})) {
    const name = dotted.split('.').pop();
    table[name] = '#' + ((layout.wrappers[dotted] || {}).id || name);
  }
  for (const name of layout.external || []) table[name] = '#' + name;
  return table;
}

let targetTable = {};

function resolveTarget(name, owner) {
  if (typeof name !== 'string') return name;
  if (name.startsWith('#')) return name;
  if (targetTable[name]) return targetTable[name];
  throw new Error(
    `flow: step '${owner}' points at '${name}', which is not a step, a group or a declared external state`
  );
}

function writesOf(spec, stepWrite) {
  const writes = [];
  if (stepWrite) writes.push(stepWrite);
  if (spec.set) writes.push(spec.set);
  if (!writes.length) return {};
  return {
    actions: assign((context, event) => {
      for (const write of writes) write(context, event);
    })
  };
}

function transitions(next, stepWrite, owner) {
  const list = Array.isArray(next) ? next : [next];
  return list.map((entry) => {
    const spec = branch(entry);
    return {
      target: resolveTarget(spec.to, owner),
      ...(spec.when ? { cond: spec.when } : {}),
      ...writesOf(spec, stepWrite)
    };
  });
}

function optionValue(option) {
  return option && typeof option === 'object' ? option.value : option;
}

function optionLabel(option) {
  return option && typeof option === 'object' ? option.label : option;
}

// `options` is either a static array or a function evaluated at entry. A static
// list is closed over at generate time and stays resume-safe; a runtime list has
// to be stored on the context, the same trade `walk` already makes.
function optionsOf(step) {
  return typeof step.options === 'function' ? step.options() : step.options;
}

function choiceGrammer(step, options) {
  return options.map((option, index) => ({
    intention: optionValue(option),
    recognize: [
      String(index + 1),
      ...(step.recognize
        ? step.recognize(option, index)
        : [String(optionValue(option)).toLowerCase()])
    ]
  }));
}

function renderOptions(options) {
  return options.map((option, index) => `*${index + 1}.*  ${optionLabel(option)}`).join('\n');
}

function readChoice(step, grammerOf) {
  return assign((context, event) => {
    const grammer = grammerOf(context);
    if (!grammer || !dialog.validateInputType(event, step.accept || REPLY_TYPES)) {
      context.intention = dialog.INTENTION_UNKOWN;
      return;
    }
    context.intention = dialog.get_intention(grammer, event, true);
  });
}

function choiceWrite(step) {
  if (!step.slot && !step.set) return null;
  return (context) => {
    const value = step.value ? step.value(context.intention) : context.intention;
    if (step.slot) context.slots.pgr[step.slot] = value;
    if (step.set) step.set(context, value);
  };
}

function assertOptionsRouted(step, options) {
  // one destination for every recognised option routes them all by construction,
  // and `in` would throw on the bare-string form
  if (typeof step.next === 'string' || step.next.to) return;
  const missing = options.filter((option) => !(optionValue(option) in step.next));
  if (missing.length) {
    throw new Error(`flow: step '${step.key}' offers option(s) ${missing.join(', ')} with no next target`);
  }
}

function choiceTransitions(step) {
  const write = choiceWrite(step);

  // A single destination means "any recognised option goes here" — the only
  // form available when the option list is built at runtime, since the
  // intentions are not known when the step is written.
  if (typeof step.next === 'string' || step.next.to) {
    const spec = branch(step.next);
    const anyRecognised = {
      target: resolveTarget(spec.to, step.key),
      cond: (context) => context.intention !== dialog.INTENTION_UNKOWN,
      ...writesOf(spec, write)
    };
    return [anyRecognised, ...fallbackOf(step)];
  }

  const branches = Object.keys(step.next).map((intention) => {
    const spec = branch(step.next[intention]);
    return {
      target: resolveTarget(spec.to, step.key),
      cond: (context) => context.intention === intention,
      ...writesOf(spec, write)
    };
  });
  return branches.concat(fallbackOf(step));
}

// What happens to input the grammar did not recognise: the retry loop by
// default, or an explicit branch when the step declares one.
function fallbackOf(step) {
  if (!step.onUnknown) return [{ target: 'error' }];
  const spec = branch(step.onUnknown);
  return [{ target: resolveTarget(spec.to, step.key), ...writesOf(spec, null) }];
}

function readInput(step) {
  const media = Array.isArray(step.accept);
  return assign((context, event) => {
    if (!dialog.validateInputType(event, step.accept)) {
      context.message = { isValid: !!(step.optional && String(event.message?.input ?? '') === '1') };
      return;
    }
    const input = media ? event.message.input : String(event.message.input).trim();
    const verdict = step.validate ? step.validate(input) : true;
    context.message = { isValid: verdict === true, retry: verdict === true ? undefined : verdict || undefined };
    if (context.message.isValid) {
      if (step.slot) context.slots.pgr[step.slot] = input;
      if (step.set) step.set(context, input);
    }
  });
}

function withTrail(preamble, path, trailBundle, context) {
  const trail = path
    .map((code) => (trailBundle && trailBundle[code] ? dialog.get_message(trailBundle[code], context.user.locale) : code))
    .join(' › ');
  return trail ? `*${trail}*\n${preamble}` : preamble;
}

function walkQuestion(step) {
  return {
    onEntry: assign((context) => {
      const { options, messageBundle, trailBundle, levelLabel } = context[step.stepSlot];
      const path = context.slots.pgr[step.pathSlot] || [];
      let preamble = render(step.preamble, { level: levelLabel }, context);
      if (step.trail) preamble = withTrail(preamble, path, trailBundle, context);
      const list = dialog.constructListPromptAndGrammer(options, messageBundle, context.user.locale, false, path.length > 0);
      context.grammer = list.grammer;
      emit(context, `${preamble}${list.prompt}`);
    }),
    on: { USER_MESSAGE: 'process' }
  };
}

function fetchState(step) {
  return {
    invoke: {
      id: step.invokeId || `fetch_${step.key}`,
      src: (context) => step.fetch(context, context.slots.pgr[step.pathSlot] || []),
      onDone: {
        target: 'evaluate',
        actions: assign((context, event) => {
          context[step.stepSlot] = event.data;
        })
      },
      onError: { target: (step.onError ? resolveTarget(step.onError, step.key) : '#system_error') }
    }
  };
}

function evaluateState(step) {
  const empty = step.onEmpty;
  const escape = empty
    ? [{
        target: resolveTarget(empty.to, step.key),
        cond: (context) => (context[step.stepSlot].options || []).length === 0,
        actions: assign((context) => {
          const path = context.slots.pgr[step.pathSlot] || [];
          context.slots.pgr[empty.slot] = path[path.length - 1];
          if (empty.set) empty.set(context);
        })
      }]
    : [];
  return { always: escape.concat([{ target: 'question' }]) };
}

function pushPath(step, context, code) {
  context.slots.pgr[step.pathSlot] = [...(context.slots.pgr[step.pathSlot] || []), code];
}

function walkTransitions(step) {
  return [
    {
      target: 'fetch',
      cond: (context) => !context[step.stepSlot]
    },
    {
      target: 'fetch',
      cond: (context) => context.intention === dialog.INTENTION_GOBACK,
      actions: assign((context) => {
        context.slots.pgr[step.pathSlot] = (context.slots.pgr[step.pathSlot] || []).slice(0, -1);
      })
    },
    {
      target: resolveTarget(step.onLeaf.to, step.key),
      cond: (context) => context.intention !== dialog.INTENTION_UNKOWN && context[step.stepSlot].isLeafLevel,
      actions: assign((context) => {
        pushPath(step, context, context.intention);
        context.slots.pgr[step.onLeaf.slot] = context.intention;
        if (step.onLeaf.set) step.onLeaf.set(context);
      })
    },
    {
      target: 'fetch',
      cond: (context) => context.intention !== dialog.INTENTION_UNKOWN,
      actions: assign((context) => {
        pushPath(step, context, context.intention);
      })
    },
    { target: 'error' }
  ];
}

function callMessage(branch, context, event) {
  return typeof branch.message === 'function'
    ? branch.message(context, event)
    : render(branch.message, branch.fill, context, event);
}

// Field contract per `kind` — what a step of that kind reads, and what each
// field does. Common to nearly all kinds: `key` (name), `id` (xstate id
// override), `next`/`onDone`/`onError` (routing target(s), declared in
// shell-transitions.js / pgr-transitions.js, not here), `fill` (template values).
//
// goto   — nothing beyond `next`. Branches immediately, sends nothing.
// gate   — nothing beyond `next`. Waits for one USER_MESSAGE, sends nothing, then branches.
// say    — `prompt`, `effect` (side effect on entry). Sends the prompt(s), then branches.
// ask    — `prompt`, `accept` (expected reply type/media), `optional`, `validate`
//          (reply -> true | retry message), `slot`/`set` (write the reply into
//          context), `retry` (fallback error message). Retries on invalid input.
// choose — `options` (list or fn), `recognize` (extra match strings per option),
//          `accept`, `slot`/`set`, `onUnknown` (fallback instead of a retry).
//          Options double as the outcome keys `next`/`onDone` route by.
// walk   — `fetch` (async fn returning the next level's options), `pathSlot`/
//          `stepSlot` (where the walked path / fetched options live in
//          context), `preamble`, `trail`, `onLeaf`/`onEmpty` (escape routes),
//          `onError`. Drills into a hierarchy one fetch per level.
// call   — `src` (async fn to run), `invokeId`, `onDone` (array of named
//          outcomes: `to`, `when`, `message`, `set`), `onError`.
const emitters = {
  // Branch immediately, send nothing. `say` with `prompt: []` would also emit
  // no message, but this states the intent and skips the no-op assign.
  goto: (step) => ({
    id: step.id || step.key,
    always: transitions(step.next, null, step.key)
  }),

  // Wait for the citizen, send nothing, then branch. The only kind that blocks
  // without asking a question. Stays atomic on purpose: the machine's entry
  // state is compared as a bare string in reminders-service, so it must not
  // become a compound `{start:'question'}`.
  gate: (step) => ({
    id: step.id || step.key,
    on: { USER_MESSAGE: transitions(step.next, null, step.key) }
  }),

  say: (step) => ({
    id: step.id || step.key,
    onEntry: assign((context, event) => {
      sendPrompts(step, context, event);
      // `effect` runs here rather than on the transition because xstate resolves
      // `always` under the null event: a transition action sees event.data as
      // undefined, an entry action sees the real triggering event.
      if (step.effect) step.effect(context, event);
    }),
    always: transitions(step.next, null, step.key)
  }),

  ask: (step) => node(step, {
    question: questionState(step),
    process: {
      onEntry: readInput(step),
      always: transitions(step.next, null, step.key)
        .map((transition) => ({
          ...transition,
          cond: transition.cond
            ? (context, event) => context.message.isValid && transition.cond(context, event)
            : (context) => context.message.isValid
        }))
        .concat([{ target: 'error' }])
    },
    error: errorState(step, (context) => context.message && context.message.retry)
  }),

  choose: (step) => {
    const dynamic = typeof step.options === 'function';
    if (!dynamic) assertOptionsRouted(step, step.options);

    const fixed = dynamic ? null : choiceGrammer(step, step.options);
    const states = {
      question: questionState(step, dynamic
        ? (context) => { context.grammer = choiceGrammer(step, optionsOf(step)); }
        : undefined),
      process: {
        onEntry: readChoice(step, dynamic ? (context) => context.grammer : () => fixed),
        always: choiceTransitions(step)
      }
    };
    // onUnknown replaces the retry path, so the error state would be unreachable
    if (!step.onUnknown) states.error = errorState(step, () => undefined);
    return node(step, states);
  },

  walk: (step) => ({
    id: step.id || step.key,
    initial: 'fetch',
    states: {
      fetch: fetchState(step),
      evaluate: evaluateState(step),
      question: walkQuestion(step),
      process: { onEntry: readChoice(step, (context) => context.grammer), always: walkTransitions(step) },
      error: errorState(step, () => undefined)
    }
  }),

  call: (step) => ({
    id: step.id || step.key,
    invoke: {
      id: step.invokeId || step.key,
      src: (context, event) => step.src(context, event),
      onDone: step.onDone.map((entry) => {
        const spec = branch(entry);
        return {
          target: resolveTarget(spec.to, step.key),
          ...(spec.when ? { cond: spec.when } : {}),
          actions: assign((context, event) => {
            if (spec.message) emit(context, callMessage(spec, context, event));
            if (spec.set) spec.set(context, event);
          })
        };
      }),
      onError: { target: (step.onError ? resolveTarget(step.onError, step.key) : '#system_error') }
    }
  })
};

function place(root, step, layout) {
  let states = root;
  const prefix = [];
  for (const name of layout.place[step.key] || []) {
    prefix.push(name);
    const dotted = prefix.join('.');
    if (!states[name]) {
      states[name] = { ...(layout.wrappers[dotted] || {}), states: {} };
      if (layout.initial[dotted]) states[name].initial = layout.initial[dotted];
    }
    states = states[name].states;
  }
  states[step.key] = emitters[step.kind](step);
}

function generate(steps, layout = {}) {
  const resolved = { wrappers: {}, place: {}, initial: {}, external: [], ...layout };
  targetTable = buildTargets(steps, resolved);
  const root = {};
  for (const step of steps) {
    if (!emitters[step.kind]) throw new Error(`flow: step '${step.key}' has unknown kind '${step.kind}'`);
    place(root, step, resolved);
  }
  return root;
}

function targetsOf(node) {
  const found = [];
  const collect = (value) => {
    if (typeof value === 'string') found.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object') collect(value.target);
  };
  collect(node.always);
  for (const event of Object.keys(node.on || {})) collect(node.on[event]);
  collect(node.invoke && node.invoke.onDone);
  collect(node.invoke && node.invoke.onError);
  return found;
}

function scan(node, out, name = '(root)') {
  if (!node || typeof node !== 'object') return out;
  if (typeof node.id === 'string') out.ids.push(node.id);
  for (const target of targetsOf(node)) if (target.startsWith('#')) out.targets.push(target);
  const children = Object.keys(node.states || {});
  if (children.length && !node.initial && name !== '(root)') out.headless.push(name);
  for (const child of children) scan(node.states[child], out, child);
  return out;
}

// Validate a whole machine config, not just its states map: the root's own
// `on` handlers are transitions too, and USER_RESET -> #welcome is the
// product's universal escape hatch. Scanning only `states` left it unchecked.
function assertTargets(config, allowed = []) {
  const out = scan(config, { ids: [], targets: [], headless: [] });
  const duplicate = out.ids.find((id, index) => out.ids.indexOf(id) !== index);
  if (duplicate) throw new Error(`flow: duplicate state id '#${duplicate}'`);
  const known = new Set(out.ids.concat(allowed));
  const missing = out.targets.find((target) => !known.has(target.slice(1)));
  if (missing) throw new Error(`flow: unknown transition target '${missing}'`);
  if (out.headless.length) throw new Error(`flow: compound state '${out.headless[0]}' has no initial state`);
  return config;
}

// Deep-merges `source` into `target`'s state tree, in place, and returns
// `target`. Used to splice a generated flow (from generate()) into a
// hand-authored machine config (state-machine.js, pgr.js). When both sides define the
// same compound state (both have `states`), their other fields and children
// are merged recursively; otherwise `source`'s definition fully replaces
// `target`'s for that key, so the generated flow always wins on conflicts.
function mergeStates(target, source) {
  for (const key of Object.keys(source)) {
    const incoming = source[key];
    const existing = target[key];
    if (existing && incoming.states && existing.states) {
      for (const field of Object.keys(incoming)) {
        if (field !== 'states') existing[field] = incoming[field];
      }
      mergeStates(existing.states, incoming.states);
    } else {
      target[key] = incoming;
    }
  }
  return target;
}

module.exports = { generate, assertTargets, mergeStates };
