// Wraps the serialized xstate state blob persisted per user (postgres-repo.js,
// in-memory-repo.js) or freshly produced by interpret(...).state
// (chat-service.js). `raw` is handed to xstate's own State.create()/
// withContext() as-is - this class does not reshape it, only names it.
class ChatState {
  constructor(raw) {
    this.raw = raw;
  }

  static create(raw) {
    return new ChatState(raw);
  }

  get context() {
    return this.raw.context;
  }

  get value() {
    return this.raw.value;
  }

  // Matches the `state` column/param name the repos (postgres-repo.js,
  // in-memory-repo.js) persist under.
  get state() {
    return JSON.stringify(this.raw);
  }

  
  // Strips per-user identifiers down to the minimum needed to resume a
  // session, in place. Callers that also need the un-stripped state (e.g. to
  // start an xstate service from it) must clone first - see toPersistableState().
  withoutUserData() {
    const state = this.raw;
    let userId = state.context.user.userId;
    let locale = state.context.user.locale;
    let mobileNumber = state.context.user.mobileNumber;
    state.context.user = undefined;
    state.context.user = { locale: locale, userId: userId, mobileNumber: mobileNumber };
    state.event = {};
    state._event = {};
    state.actions = [];

    // history keeps its OWN copy of the event that produced it, and that event
    // is the inbound model — service-account authToken included. Looped rather
    // than done once: toJSON caps the chain today, nothing guarantees it will.
    for (let past = state.history; past; past = past.history) {
      if (past.context) past.context.user = {};
      past.event = {};
      past._event = {};
      past.actions = [];
    }

    return this;
  }

  // A deep-cloned, user-data-stripped copy safe to persist - never mutates
  // the state this instance wraps.
  toPersistableState() {
    return ChatState.create(JSON.parse(JSON.stringify(this.raw))).withoutUserData();
  }
}

module.exports = ChatState;
