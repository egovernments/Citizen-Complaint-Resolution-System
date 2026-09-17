// Joins an authored states table to an authored transitions table, producing the
// steps `generate()` already understands.
//
// The authoring surface is two files per journey: states say what each step IS,
// transitions say where each step GOES. The generator's surface is unchanged — it
// still receives one step object per state with `next`, `onLeaf.to`, `onDone[]`
// and so on. Keeping those two contracts separate is what lets the emitters stay
// untouched, and what lets the generator's own tests keep constructing joined
// steps directly.

// Keys in an exits entry that name a generator concept rather than an option or
// a call outcome.
const ON_LEAF = 'onLeaf';
const ON_EMPTY = 'onEmpty';
const ON_UNKNOWN = 'onUnknown';
const ON_ERROR = 'onError';
const ON_ANY = 'onAny';
const RESERVED = new Set([ON_LEAF, ON_EMPTY, ON_UNKNOWN, ON_ERROR, ON_ANY]);

// Kinds that must declare somewhere to go. Every kind, as it happens — a step
// with no exit is a dead end, and the machine has no dead ends.
const NEEDS_EXIT = new Set(['say', 'ask', 'choose', 'walk', 'call', 'gate', 'goto']);

const isPlainObject = (value) =>
  !!value && typeof value === 'object' && !Array.isArray(value);

// A transitions entry may name its destination three ways. `['welcome', guard]`
// is the terse pair form; `{ to, when, set }` passes straight through for the
// rare branch that carries a write.
function toBranch(entry) {
  if (typeof entry === 'string') return { to: entry };
  if (Array.isArray(entry)) return entry[1] ? { to: entry[0], when: entry[1] } : { to: entry[0] };
  return entry;
}

function toBranchList(exit) {
  return Array.isArray(exit) ? exit.map(toBranch) : [toBranch(exit)];
}

function optionKeys(exit) {
  return Object.keys(exit).filter((key) => !RESERVED.has(key));
}

function foldChoose(state, exit) {
  const folded = {};
  if (!isPlainObject(exit)) {
    folded.next = toBranch(exit);
  } else if (exit[ON_ANY] !== undefined) {
    // one destination for every recognised option — the only form available when
    // the option list is built at runtime
    folded.next = toBranch(exit[ON_ANY]);
  } else {
    folded.next = {};
    for (const option of optionKeys(exit)) folded.next[option] = exit[option];
  }
  if (state[ON_UNKNOWN] || (isPlainObject(exit) && exit[ON_UNKNOWN] !== undefined)) {
    folded[ON_UNKNOWN] = { ...(state[ON_UNKNOWN] || {}), to: exit[ON_UNKNOWN] };
  }
  return folded;
}

function foldWalk(state, exit) {
  const folded = { [ON_LEAF]: { ...state[ON_LEAF], to: exit[ON_LEAF] } };
  if (state[ON_EMPTY]) folded[ON_EMPTY] = { ...state[ON_EMPTY], to: exit[ON_EMPTY] };
  if (exit[ON_ERROR]) folded[ON_ERROR] = exit[ON_ERROR];
  return folded;
}

// The state owns each outcome's guard and message; transitions own its target.
// Joining by NAME rather than by position is what makes the split safe: an
// ordered array split across two files would drift the first time one is edited.
function foldCall(state, exit) {
  const outcomes = Object.keys(state.onDone);
  const folded = {
    onDone: outcomes.map((name) => ({ ...state.onDone[name], to: exit[name] }))
  };
  if (exit[ON_ERROR]) folded[ON_ERROR] = exit[ON_ERROR];
  return folded;
}

function foldExit(state, exit) {
  if (state.kind === 'walk') return foldWalk(state, exit);
  if (state.kind === 'call') return foldCall(state, exit);
  if (state.kind === 'choose') return foldChoose(state, exit);
  return { next: Array.isArray(exit) ? toBranchList(exit) : toBranch(exit) };
}

function assertExitsMatchStates(states, exits) {
  const keys = new Set(states.map((state) => state.key));
  for (const key of Object.keys(exits)) {
    if (!keys.has(key)) {
      throw new Error(`flow: transitions declare an exit for '${key}', which is not a state`);
    }
  }
  for (const state of states) {
    if (NEEDS_EXIT.has(state.kind) && exits[state.key] === undefined) {
      throw new Error(`flow: state '${state.key}' (${state.kind}) has no exit in transitions`);
    }
  }
}

// Object key order decides which guard is tried first, where an array made that
// explicit. So the last outcome must be the unconditional one.
function assertOutcomesEndUnguarded(states) {
  for (const state of states) {
    if (state.kind !== 'call') continue;
    const outcomes = Object.keys(state.onDone);
    const last = state.onDone[outcomes[outcomes.length - 1]];
    if (last && last.when) {
      throw new Error(
        `flow: state '${state.key}' declares outcome '${outcomes[outcomes.length - 1]}' last, `
        + 'but it carries a guard — the final outcome must be unconditional'
      );
    }
  }
}

// Every dotted path the tree actually has a node for: the journey root, the
// declared wrappers, and every prefix of a placement chain.
function groupPaths(layout) {
  const paths = new Set(layout.root ? [layout.root] : []);
  for (const dotted of Object.keys(layout.wrappers || {})) paths.add(dotted);
  for (const chain of Object.values(layout.place || {})) {
    chain.forEach((name, depth) => paths.add(chain.slice(0, depth + 1).join('.')));
  }
  return paths;
}

// A group starts at one of its children, which is either a step or a nested
// group. An unrecognised name here would leave the group with no `initial`, and
// XState only warns about that.
function assertEntryNamesGroups(states, entry, layout) {
  const paths = groupPaths(layout);
  const children = new Set(states.map((state) => state.key));
  for (const dotted of Object.keys(layout.wrappers || {})) children.add(dotted.split('.').pop());

  for (const group of Object.keys(entry)) {
    if (!paths.has(group)) {
      throw new Error(`flow: entry declares a start for '${group}', which is not a group in the layout`);
    }
    if (!children.has(entry[group])) {
      throw new Error(`flow: '${group}' starts at '${entry[group]}', which is not a state or a group`);
    }
  }
}

function join(states, transitions, layout = {}) {
  const exits = transitions.exits || {};
  const entry = transitions.entry || {};

  assertExitsMatchStates(states, exits);
  assertOutcomesEndUnguarded(states);
  assertEntryNamesGroups(states, entry, layout);

  return {
    steps: states.map((state) => ({ ...state, ...foldExit(state, exits[state.key]) })),
    layout: { ...layout, initial: entry }
  };
}

module.exports = { join };
