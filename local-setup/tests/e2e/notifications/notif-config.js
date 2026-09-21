'use strict';
/*
 * ============================================================================
 * notif-config.js — the notification config rules, as PURE functions
 * ============================================================================
 *
 * Everything in this file is a pure function: no `require`, no env, no I/O, no
 * module state. That is deliberate. The e2e scripts that use it can only run on
 * a DIGIT host (they shell out to `docker exec psql` and reach Kong), so the
 * logic that decides WHAT to expect would otherwise be untestable. Here it is
 * testable with `node --test notif-config.test.js` on any machine.
 *
 * What lives here:
 *
 *   1. Source selection  — which namespace serves a tenant's notification
 *      config. Mirrors the bridge's rule (design 5.2): a tenant with rows in
 *      NOTIFICATIONS.Routing is served the new masters; a tenant with none is
 *      served the legacy RAINMAKER-PGR.Notification* rows through an adapter.
 *      PER TENANT, ALL-OR-NOTHING, never per row.
 *
 *   2. eventName parsing — COMPLAINTS.WORKFLOW.<ACTION>.<TOSTATE> back into the
 *      (action, toState) pair the dispatch log's transaction_id still carries.
 *
 *   3. Audience schemes  — ACTOR:citizen, ACTOR:assignee, ROLE:<code>,
 *      EVENT_RECIPIENTS and pipe chains, plus the legacy bare-name table
 *      (design 2.3). This is the same mapping as
 *      local-setup/scripts/notifications_convert.py, in JavaScript, INCLUDING
 *      the audience-index join hazard that file documents: a routing row with
 *      assigneeOnly=true becomes ACTOR:assignee|ROLE:X while its template row,
 *      which has no assigneeOnly column, would map to a bare ROLE:X. Template
 *      lookups therefore reuse the audience string routing produced.
 *
 *   4. The channel-outcome expectation table — what status/error code a row
 *      SHOULD carry, derived from the tenant's own channel policy rather than
 *      hardcoded. The old scripts asserted "WhatsApp is always
 *      SKIPPED/NB_NO_PROVIDER", which is only true while nobody has switched
 *      WhatsApp on.
 *
 * Nothing here knows about psql, Kong or Docker. The callers read the rows and
 * hand them in.
 * ============================================================================
 */

// ---------------------------------------------------------------------------
// Constants (mirrors of production constants; each says which one)
// ---------------------------------------------------------------------------

/** Channels the masters accept. NotificationRouter drops anything else. */
const VALID_CHANNELS = ['SMS', 'WHATSAPP', 'EMAIL'];

/** Audiences that are not notifiable — dropped with a warning, as today. */
const NON_NOTIFIABLE = ['AUTO_ESCALATE', 'SYSTEM'];

/** Legacy bare audience names that are named actors, not role pools (design 2.3). */
const BARE_ACTORS = { CITIZEN: 'ACTOR:citizen', EMPLOYEE: 'ACTOR:assignee' };

/** The pseudo-channel a channel-less resolution decision is recorded under. */
const CHANNEL_NONE = 'NONE';

/** The default eventName prefix for PGR workflow transitions. */
const PGR_EVENT_PREFIX = 'COMPLAINTS.WORKFLOW';

/**
 * The five masters, in both namespaces. `legacy: null` means the master is new
 * and has no pre-move equivalent — there is nothing to fall back to.
 */
const MASTERS = {
  Routing: { next: 'NOTIFICATIONS.Routing', legacy: 'RAINMAKER-PGR.NotificationRouting' },
  Template: { next: 'NOTIFICATIONS.Template', legacy: 'RAINMAKER-PGR.NotificationTemplate' },
  ProviderTemplate: {
    next: 'NOTIFICATIONS.ProviderTemplate',
    legacy: 'RAINMAKER-PGR.NotificationProviderTemplate',
  },
  Channel: { next: 'NOTIFICATIONS.Channel', legacy: 'RAINMAKER-PGR.NotificationChannel' },
  EventCatalogue: { next: 'NOTIFICATIONS.EventCatalogue', legacy: null },
};

/** The two source names. `SOURCE.NEXT` is the NOTIFICATIONS.* namespace. */
const SOURCE = { NEXT: 'NOTIFICATIONS', LEGACY: 'RAINMAKER-PGR' };

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const s = (v) => (v == null ? '' : String(v).trim());
const up = (v) => s(v).toUpperCase();

function truthy(v) {
  if (typeof v === 'boolean') return v;
  if (v == null) return false;
  return ['true', '1', 'yes'].includes(s(v).toLowerCase());
}

/** A row's active flag, defaulting to true exactly as the seeder does. */
function isActive(row) {
  if (!row || typeof row !== 'object') return false;
  if ('active' in row) return truthy(row.active);
  if ('isActive' in row) return truthy(row.isActive);
  return true;
}

// ---------------------------------------------------------------------------
// 1. Source selection
// ---------------------------------------------------------------------------

/**
 * Which namespace serves this tenant, from the number of ACTIVE rows it has in
 * NOTIFICATIONS.Routing.
 *
 * Routing is the key master on purpose: it is the one the bridge's
 * NotificationConfigRepository keys the whole decision on, because the template
 * conversion needs the routing rows as context to get the audience join right.
 * Four independent per-master decisions is the per-row precedence between two
 * namespaces that nobody can reason about at 2am.
 *
 * @param {number} newRoutingRowCount active rows in NOTIFICATIONS.Routing at the state tenant
 * @returns {'NOTIFICATIONS'|'RAINMAKER-PGR'}
 */
function selectSource(newRoutingRowCount) {
  const n = Number(newRoutingRowCount);
  return Number.isFinite(n) && n > 0 ? SOURCE.NEXT : SOURCE.LEGACY;
}

/** The MDMS schema code for a master under a chosen source. */
function schemaCodeFor(master, source) {
  const entry = MASTERS[master];
  if (!entry) throw new Error(`unknown notification master: ${master}`);
  if (source === SOURCE.LEGACY) {
    // EventCatalogue is new; there is no legacy code to fall back to, and
    // pretending there is one would produce a search that silently returns [].
    return entry.legacy;
  }
  return entry.next;
}

/** `{moduleName, masterName}` for an mdms-v2 v1-compat `_search` of a master. */
function mdmsModuleMaster(master, source) {
  const code = schemaCodeFor(master, source);
  if (!code) return null;
  const dot = code.indexOf('.');
  return { moduleName: code.slice(0, dot), masterName: code.slice(dot + 1) };
}

// ---------------------------------------------------------------------------
// 2. eventName
// ---------------------------------------------------------------------------

/**
 * `COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME` -> `{prefix, action, toState}`.
 *
 * The last two dotted segments are the action and the target state: neither a
 * workflow action nor a DIGIT applicationStatus ever contains a dot, and the
 * prefix is whatever the producing module chose. Returns null rather than
 * guessing when there are fewer than four segments — a name we cannot split is
 * a name whose (action, toState) we must not invent, because the dispatch log's
 * transaction_id is parsed on exactly that pair.
 */
function parseEventName(eventName) {
  const parts = s(eventName)
    .split('.')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length < 4) return null;
  return {
    prefix: parts.slice(0, -2).join('.'),
    action: parts[parts.length - 2].toUpperCase(),
    toState: parts[parts.length - 1].toUpperCase(),
  };
}

/** The inverse: `('ASSIGN','PENDINGATLME') -> 'COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME'`. */
function eventNameFor(action, toState, prefix) {
  const a = up(action);
  const t = up(toState);
  if (!a || !t) return null;
  return `${s(prefix) || PGR_EVENT_PREFIX}.${a}.${t}`;
}

/** The ledger's event_name for a transition: `COMPLAINTS.WORKFLOW.<ACTION>` (no toState). */
function ledgerEventNameFor(action) {
  const a = up(action);
  return a ? `${PGR_EVENT_PREFIX}.${a}` : null;
}

// ---------------------------------------------------------------------------
// 3. Audience schemes
// ---------------------------------------------------------------------------

/** True when `audience` is ALREADY a scheme reference and must be left alone. */
function isSchemeRef(audience) {
  const a = s(audience);
  if (!a) return false;
  return a.split('|').some((part) => {
    const p = part.trim();
    return p.startsWith('ACTOR:') || p.startsWith('ROLE:') || p === 'EVENT_RECIPIENTS';
  });
}

/**
 * Legacy bare audience (+ assigneeOnly) -> an audience reference with a scheme.
 * Byte-for-byte the table in notifications_convert.audience_ref().
 *
 * @returns {string|null} null means "not notifiable — drop the row"
 */
function audienceRef(audience, assigneeOnly) {
  const a = s(audience);
  if (!a) return null;
  if (isSchemeRef(a)) return a;
  if (NON_NOTIFIABLE.includes(a.toUpperCase())) return null;
  if (BARE_ACTORS[a.toUpperCase()]) return BARE_ACTORS[a.toUpperCase()];
  // "Notify the named assignee, but fall through to the role pool rather than
  // notifying no one" is exactly a pipe chain.
  if (truthy(assigneeOnly)) return `ACTOR:assignee|ROLE:${a}`;
  return `ROLE:${a}`;
}

/**
 * Split an audience reference into its ordered terms.
 *
 * Accepts both wire forms — a scheme reference and a legacy bare name — so a
 * caller never has to know which namespace a row came from. An unknown scheme
 * is reported as `UNKNOWN` rather than guessed at: that is the case the bridge
 * records as NB_UNKNOWN_AUDIENCE_SCHEME.
 *
 * @returns {{ref:string, label:string, terms:Array, notifiable:boolean}}
 */
function parseAudience(audience, assigneeOnly) {
  const ref = audienceRef(audience, assigneeOnly);
  if (ref == null) {
    return { ref: null, label: up(audience) || '(blank)', terms: [], notifiable: false };
  }
  const terms = ref.split('|').map((raw) => {
    const part = raw.trim();
    if (part === 'EVENT_RECIPIENTS') return { scheme: 'EVENT_RECIPIENTS', name: null, raw: part };
    const colon = part.indexOf(':');
    if (colon < 0) {
      // A bare name inside a chain: map it the same way a standalone one maps.
      const mapped = audienceRef(part, false);
      if (mapped == null) return { scheme: 'NON_NOTIFIABLE', name: part.toUpperCase(), raw: part };
      return parseAudience(mapped).terms[0];
    }
    const scheme = part.slice(0, colon).trim().toUpperCase();
    const name = part.slice(colon + 1).trim();
    if (scheme === 'ACTOR') return { scheme: 'ACTOR', name, raw: part };
    if (scheme === 'ROLE') return { scheme: 'ROLE', name: name.toUpperCase(), raw: part };
    return { scheme: 'UNKNOWN', name, raw: part };
  });
  return { ref, label: audienceLabel(ref), terms, notifiable: terms.length > 0 };
}

/**
 * A short, readable name for an audience reference, for test output and for the
 * role cross-check messages: `ACTOR:citizen` -> `CITIZEN`, `ACTOR:assignee` ->
 * `ASSIGNEE`, `ROLE:GRO` -> `GRO`, a chain -> `ASSIGNEE|GRO`.
 */
function audienceLabel(ref) {
  const a = s(ref);
  if (!a) return '(blank)';
  return a
    .split('|')
    .map((part) => {
      const p = part.trim();
      if (p === 'EVENT_RECIPIENTS') return 'EVENT_RECIPIENTS';
      if (p.toUpperCase().startsWith('ACTOR:')) return p.slice(6).trim().toUpperCase();
      if (p.toUpperCase().startsWith('ROLE:')) return p.slice(5).trim().toUpperCase();
      return p.toUpperCase();
    })
    .join('|');
}

/**
 * The term of a chain that would actually resolve, given what the tenant holds.
 * "First form that yields a non-empty list" (design 2.3).
 *
 * @param {Array} terms from parseAudience().terms
 * @param {{hasActor:function(string):boolean, roleHolderCount:function(string):number,
 *          hasEventRecipients:boolean}} ctx
 * @returns {{term:object|null, reason:string}} term===null means the whole chain is empty
 */
function resolveAudience(terms, ctx) {
  const hasActor = (ctx && ctx.hasActor) || (() => false);
  const roleHolderCount = (ctx && ctx.roleHolderCount) || (() => 0);
  const unknowns = [];
  for (const term of terms || []) {
    if (term.scheme === 'ACTOR') {
      if (hasActor(term.name)) return { term, reason: `actor ${term.name} is named on this event` };
      continue;
    }
    if (term.scheme === 'ROLE') {
      const n = roleHolderCount(term.name);
      if (n > 0) return { term, reason: `role ${term.name} has ${n} holder(s) in this tenant` };
      continue;
    }
    if (term.scheme === 'EVENT_RECIPIENTS') {
      if (ctx && ctx.hasEventRecipients) return { term, reason: 'the event carries recipients[]' };
      continue;
    }
    unknowns.push(term.raw);
  }
  if (unknowns.length) {
    return { term: null, reason: `unknown audience scheme(s): ${unknowns.join(', ')}` };
  }
  return { term: null, reason: 'no term of the chain resolves to anybody in this tenant' };
}

/**
 * Does this dispatch row belong to this audience term?
 *
 * @param {object} term one of parseAudience().terms
 * @param {{uuid:string}} row a parsed nb_dispatch_log row
 * @param {{citizenUuid:string, assigneeUuid:string|null, rolesOf:function(string):Set}} ctx
 */
function rowMatchesTerm(term, row, ctx) {
  const uuid = s(row && row.uuid);
  if (!term) return false;
  if (term.scheme === 'ACTOR' && String(term.name).toLowerCase() === 'citizen') {
    return !!uuid && uuid === s(ctx.citizenUuid);
  }
  if (term.scheme === 'ACTOR' && String(term.name).toLowerCase() === 'assignee') {
    if (ctx.assigneeUuid) return uuid === s(ctx.assigneeUuid);
    // Assignee not known for this transition: fall back to the pre-move check —
    // somebody who is not the citizen and holds the EMPLOYEE role. Strictly
    // weaker than the uuid comparison, which is why the uuid is preferred.
    return !!uuid && uuid !== s(ctx.citizenUuid) && ctx.rolesOf(uuid).has('EMPLOYEE');
  }
  if (term.scheme === 'ACTOR') {
    // Some other named actor. Only the producer knows who it is, so all we can
    // assert is "somebody, and not by accident the citizen".
    return !!uuid && uuid !== s(ctx.citizenUuid);
  }
  if (term.scheme === 'ROLE') {
    return !!uuid && ctx.rolesOf(uuid).has(term.name);
  }
  if (term.scheme === 'EVENT_RECIPIENTS') {
    return !!uuid;
  }
  return false;
}

/** Any term of the audience matches — used when a chain's resolved term is unknown. */
function rowMatchesAudience(terms, row, ctx) {
  return (terms || []).some((term) => rowMatchesTerm(term, row, ctx));
}

// ---------------------------------------------------------------------------
// The audience-index join (ported verbatim from notifications_convert.py)
// ---------------------------------------------------------------------------

/**
 * How routing mapped each legacy audience, so template and provider-template
 * rows — which carry no assigneeOnly column — end up on the SAME audience
 * string routing produced. Without this the join breaks silently.
 *
 * @returns {Map<string,string>} keys are `AUD|ACTION|TOSTATE|CHANNEL` and
 *          `AUD|ACTION|TOSTATE` (the latter only when every channel agreed)
 */
function buildAudienceIndex(legacyRoutingRows) {
  const exact = new Map();
  const grouped = new Map();
  for (const row of legacyRoutingRows || []) {
    if (row && row.eventName && row.action === undefined) continue; // already converted
    const ref = audienceRef(row.audience, row.assigneeOnly);
    if (ref == null) continue;
    const legacy = up(row.audience);
    const action = up(row.action);
    const toState = up(row.toState);
    const channel = up(row.channel);
    exact.set(`${legacy}|${action}|${toState}|${channel}`, ref);
    const gk = `${legacy}|${action}|${toState}`;
    if (!grouped.has(gk)) grouped.set(gk, new Set());
    grouped.get(gk).add(ref);
  }
  for (const [key, refs] of grouped.entries()) {
    if (refs.size === 1) exact.set(key, [...refs][0]);
  }
  return exact;
}

/** The audience string the matching routing row produced, else the bare mapping. */
function joinedAudience(row, audienceIndex) {
  const legacy = up(row.audience);
  const action = up(row.action);
  const toState = up(row.toState);
  const channel = up(row.channel);
  if (audienceIndex) {
    for (const key of [`${legacy}|${action}|${toState}|${channel}`, `${legacy}|${action}|${toState}`]) {
      if (audienceIndex.has(key)) return audienceIndex.get(key);
    }
  }
  return audienceRef(row.audience, false);
}

// ---------------------------------------------------------------------------
// The EXPECT matrix
// ---------------------------------------------------------------------------

/**
 * Flatten routing rows — from EITHER namespace — into the one shape every
 * assertion works on:
 *
 *     {action, toState, eventName, audience (a scheme ref), label, terms, channel}
 *
 * The legacy branch replays NotificationRouter.route()'s filters exactly as the
 * script always has (drop active:false, filter businessService, uppercase, drop
 * AUTO_ESCALATE/SYSTEM, drop channels outside {SMS,WHATSAPP,EMAIL}, dedupe) and
 * then maps each bare audience through the §2.3 table so the downstream code is
 * one path. The NOTIFICATIONS branch has no businessService and no fromState to
 * filter on — that is the shrinkage design §8.4 promised — and splits the
 * eventName instead.
 *
 * @returns {{rows:Array, skipped:Array}} skipped carries (row, reason) pairs so
 *          a caller can print what it dropped rather than losing it
 */
function buildExpectRows(options) {
  const opts = options || {};
  const source = opts.source === SOURCE.NEXT ? SOURCE.NEXT : SOURCE.LEGACY;
  const businessService = up(opts.businessService) || 'PGR';
  const out = [];
  const skipped = [];
  const seen = new Set();

  for (const row of opts.rows || []) {
    if (!row || typeof row !== 'object') continue;
    if (!isActive(row)) continue;

    let action;
    let toState;
    let eventName;
    let audience;

    if (source === SOURCE.NEXT) {
      eventName = s(row.eventName);
      const parsed = parseEventName(eventName);
      if (!parsed) {
        skipped.push([row, `eventName ${eventName || '(blank)'} is not <PREFIX>.<ACTION>.<TOSTATE>`]);
        continue;
      }
      action = parsed.action;
      toState = parsed.toState;
      audience = s(row.audience);
    } else {
      const bs = up(row.businessService);
      if (bs && bs !== businessService) continue;
      action = up(row.action);
      toState = up(row.toState);
      if (!action || !toState) {
        skipped.push([row, 'blank action or toState']);
        continue;
      }
      eventName = eventNameFor(action, toState);
      audience = audienceRef(row.audience, row.assigneeOnly);
      if (audience == null) {
        skipped.push([row, `audience ${up(row.audience) || '(blank)'} is not notifiable`]);
        continue;
      }
    }

    const parsedAudience = parseAudience(audience);
    if (!parsedAudience.notifiable) {
      skipped.push([row, `audience ${audience || '(blank)'} is not notifiable`]);
      continue;
    }

    const channel = up(row.channel);
    if (!VALID_CHANNELS.includes(channel)) {
      skipped.push([row, `channel ${channel || '(blank)'} is not one of ${VALID_CHANNELS.join('/')}`]);
      continue;
    }

    const key = `${action}|${toState}|${parsedAudience.ref}|${channel}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      action,
      toState,
      eventName,
      audience: parsedAudience.ref,
      label: parsedAudience.label,
      terms: parsedAudience.terms,
      channel,
    });
  }
  return { rows: out, skipped };
}

/** Group an EXPECT matrix by audience for one (action, toState). */
function specsFor(expectRows, action, toState) {
  const A = up(action);
  const S = up(toState);
  const byAudience = new Map();
  for (const r of expectRows || []) {
    if (r.action !== A || r.toState !== S) continue;
    if (!byAudience.has(r.audience)) {
      byAudience.set(r.audience, { audience: r.audience, label: r.label, terms: r.terms, channels: new Set() });
    }
    byAudience.get(r.audience).channels.add(r.channel);
  }
  return [...byAudience.values()].map((spec) => ({ ...spec, channels: [...spec.channels] }));
}

/** Lower-bound row count for a transition = the number of (audience, channel) tuples. */
function tupleCount(expectRows, action, toState) {
  return specsFor(expectRows, action, toState).reduce((n, spec) => n + spec.channels.length, 0);
}

// ---------------------------------------------------------------------------
// 4. Channel policy + the outcome expectation table
// ---------------------------------------------------------------------------

/**
 * The tenant's channel policy, resolved exactly as ChannelPolicyClient resolves
 * it: NOTIFICATIONS.Channel rows if the tenant has any, else the legacy
 * RAINMAKER-PGR.NotificationChannel rows, else the deployment-wide env
 * allowlist `novu.bridge.channels.enabled` — which defaults to EMPTY, meaning
 * every channel is off until an operator names one.
 *
 * A tenant WITH rows is governed by them alone: a channel with no row is off.
 * No env leakage. That is the rule the bridge enforces and the one an operator
 * gets caught by.
 *
 * @param {{newRows:Array, legacyRows:Array, envEnabled:Array<string>}} options
 * @returns {{source:string, byChannel:Object}}
 */
function channelPolicyFrom(options) {
  const opts = options || {};
  const pick = (rows) => (rows || []).filter((r) => r && isActive(r) && s(r.code));
  const newRows = pick(opts.newRows);
  const legacyRows = pick(opts.legacyRows);
  const chosen = newRows.length ? newRows : legacyRows;
  const source = newRows.length
    ? 'NOTIFICATIONS.Channel'
    : legacyRows.length
      ? 'RAINMAKER-PGR.NotificationChannel'
      : 'env:novu.bridge.channels.enabled';

  const byChannel = {};
  if (chosen.length) {
    for (const row of chosen) {
      byChannel[up(row.code)] = {
        enabled: truthy(row.enabled),
        provider: s(row.provider) || null,
        gateway: s(row.gateway) || null,
        fromRow: true,
      };
    }
    // A channel with no row is OFF for a tenant that has rows at all.
    for (const ch of VALID_CHANNELS) {
      if (!byChannel[ch]) byChannel[ch] = { enabled: false, provider: null, gateway: null, fromRow: false };
    }
  } else {
    const env = (opts.envEnabled || []).map((c) => up(c)).filter(Boolean);
    for (const ch of VALID_CHANNELS) {
      byChannel[ch] = { enabled: env.includes(ch), provider: null, gateway: null, fromRow: false };
    }
  }
  return { source, byChannel };
}

/** The policy for one channel, defaulting to "off" for a channel nobody named. */
function policyFor(policy, channel) {
  const ch = up(channel);
  const byChannel = (policy && policy.byChannel) || {};
  return byChannel[ch] || { enabled: false, provider: null, gateway: null, fromRow: false };
}

/**
 * What a dispatch row for (recipient x channel) SHOULD say, derived from the
 * tenant's own config rather than hardcoded.
 *
 * The order below is the gate order in DispatchPipelineService, which is the
 * thing being asserted — it is NOT the order the task description lists, and
 * the difference is real: the WhatsApp template gate runs BEFORE the provider
 * availability gate, so a tenant that has both problems records
 * NB_TEMPLATE_NOT_APPROVED. Where both could apply, the other code is accepted
 * as a tolerated alternative rather than pretended away.
 *
 *   1. channel not enabled for the tenant        -> SKIPPED / NB_NO_PROVIDER
 *   2. recipient has no contact for the channel  -> SKIPPED / NB_CONTACT_MISSING   (per recipient;
 *                                                   see `contactMissingExpected` — not predictable
 *                                                   from config, so it is a tolerated outcome)
 *   3. WHATSAPP with no approved provider template -> SKIPPED / NB_TEMPLATE_NOT_APPROVED
 *   4. the selected provider is unusable         -> SKIPPED / NB_PROVIDER_UNAVAILABLE
 *   5. otherwise                                 -> SENT (DELIVERED once a receipt lands)
 *
 * @param {{channel:string, policy:object, approvedProviderTemplates:number,
 *          providerUsable:boolean|null}} options
 *        providerUsable === null means "could not be determined from here" — the
 *        script cannot reach Novu, so NB_PROVIDER_UNAVAILABLE becomes a tolerated
 *        outcome that is reported as a warning instead of being silently accepted.
 * @returns {{status:string, code:string|null, reason:string, tolerate:Array}}
 */
function channelExpectation(options) {
  const opts = options || {};
  const channel = up(opts.channel);
  const p = policyFor(opts.policy, channel);
  const approved = Number(opts.approvedProviderTemplates || 0);
  const usable = opts.providerUsable === undefined ? null : opts.providerUsable;

  // Every recipient can lack the channel's contact; that is a property of the
  // person, not of the config, so it is always an accepted outcome. It used to
  // be silent (the producer filtered the recipient out); it is now a row.
  const contactMissing = {
    status: 'SKIPPED',
    code: 'NB_CONTACT_MISSING',
    reason: `the recipient has no ${channel === 'EMAIL' ? 'email' : 'phone'} for ${channel}`,
    warn: false,
  };

  if (!p.enabled) {
    return {
      status: 'SKIPPED',
      code: 'NB_NO_PROVIDER',
      reason: `${channel} is not enabled for this tenant (${(opts.policy && opts.policy.source) || 'unknown source'})`,
      tolerate: [],
    };
  }

  if (channel === 'WHATSAPP' && approved <= 0) {
    return {
      status: 'SKIPPED',
      code: 'NB_TEMPLATE_NOT_APPROVED',
      reason: `${channel} is enabled but no approved provider template matches this (event, audience)`,
      tolerate: usable === false
        ? [{ status: 'SKIPPED', code: 'NB_PROVIDER_UNAVAILABLE', reason: 'the selected provider is also unusable', warn: false }, contactMissing]
        : [contactMissing],
    };
  }

  if (usable === false) {
    return {
      status: 'SKIPPED',
      code: 'NB_PROVIDER_UNAVAILABLE',
      reason: `${channel} is enabled but the selected provider ${p.provider || '(none)'} is unusable`,
      tolerate: [contactMissing],
    };
  }

  const tolerate = [contactMissing];
  if (usable === null && p.provider) {
    tolerate.push({
      status: 'SKIPPED',
      code: 'NB_PROVIDER_UNAVAILABLE',
      reason: `provider ${p.provider} could not be probed from here`,
      warn: true,
    });
  }
  return {
    status: 'SENT',
    code: null,
    reason: `${channel} is enabled${p.provider ? ` through ${p.provider}` : ''} and a template resolves`,
    tolerate,
  };
}

/** Statuses that mean "the bridge handed it to a provider". */
const DELIVERED_STATUSES = ['SENT', 'DELIVERED'];

/**
 * Judge one observed row against an expectation.
 * @returns {{verdict:'match'|'tolerated'|'mismatch', warn:boolean, note:string}}
 */
function judgeRow(expectation, row) {
  const status = up(row && row.status);
  const code = s(row && row.lastError);
  if (expectation.status === 'SENT' && !expectation.code) {
    if (DELIVERED_STATUSES.includes(status)) return { verdict: 'match', warn: false, note: status };
  } else if (status === up(expectation.status) && code === expectation.code) {
    return { verdict: 'match', warn: false, note: `${status}/${code}` };
  }
  for (const t of expectation.tolerate || []) {
    if (status === up(t.status) && code === (t.code || '')) {
      return { verdict: 'tolerated', warn: !!t.warn, note: `${status}/${code} — ${t.reason}` };
    }
  }
  return { verdict: 'mismatch', warn: false, note: `${status}${code ? '/' + code : ''}` };
}

// ---------------------------------------------------------------------------
// Provider templates (for the WhatsApp expectation)
// ---------------------------------------------------------------------------

/**
 * Count approved, active provider-template rows for (action, toState, audience,
 * channel), from EITHER namespace. Legacy rows are mapped through the audience
 * index so a routing row with assigneeOnly=true still finds its template.
 *
 * @param {{rows:Array, source:string, audienceIndex:Map}} config
 */
function providerTemplateCounter(config) {
  const cfg = config || {};
  const source = cfg.source === SOURCE.NEXT ? SOURCE.NEXT : SOURCE.LEGACY;
  const index = new Map();
  for (const row of cfg.rows || []) {
    if (!row || !isActive(row)) continue;
    if (s(row.approvalStatus).toLowerCase() !== 'approved') continue;
    let action;
    let toState;
    let audience;
    if (source === SOURCE.NEXT) {
      const parsed = parseEventName(row.eventName);
      if (!parsed) continue;
      action = parsed.action;
      toState = parsed.toState;
      audience = s(row.audience);
    } else {
      action = up(row.action);
      toState = up(row.toState);
      audience = joinedAudience(row, cfg.audienceIndex);
    }
    if (audience == null) continue;
    const key = `${action}|${toState}|${audience}|${up(row.channel)}`;
    index.set(key, (index.get(key) || 0) + 1);
  }
  return function count(action, toState, audience, channel) {
    return index.get(`${up(action)}|${up(toState)}|${s(audience)}|${up(channel)}`) || 0;
  };
}

// ---------------------------------------------------------------------------
// Dispatch-log row shapes
// ---------------------------------------------------------------------------

/**
 * Parse a transaction_id into what the assertions read off it.
 *
 * Two shapes exist, and both must parse:
 *   `<serviceRequestId>:<ACTION>:<TOSTATE>:<tenant>:<subscriberKey>:<CHANNEL>` — six parts,
 *      the pre-move shape, which design §2.5's transactionSeed is chosen to preserve;
 *   `<serviceRequestId>:<ACTION>:<TOSTATE>:NONE` — four parts, a channel-less
 *      resolution decision (NB_NO_ROUTING and friends).
 */
function parseTransactionId(txn) {
  const parts = s(txn).split(':');
  const channelLess = parts.length === 4 && parts[3].toUpperCase() === CHANNEL_NONE;
  return {
    parts,
    action: up(parts[1] || ''),
    toState: up(parts[2] || ''),
    uuid: parts.length >= 6 ? parts[parts.length - 2] : '',
    channel: channelLess ? CHANNEL_NONE : up(parts[parts.length - 1] || ''),
    channelLess,
    wellFormed: parts.length === 6 || channelLess,
  };
}

/**
 * The E2E-4 expectation for a transition with NO routing rows.
 *
 * Old: exactly zero dispatch rows.
 * New: exactly ONE channel-less row, SKIPPED / NB_NO_ROUTING at channel NONE —
 * because the box now records the decision it used to take silently.
 *
 * `thinPath` is tri-state on purpose. A server still running the pre-move
 * producer writes nothing at all, and calling that a failure would mean this
 * script could only ever run on one half of the fleet. `null` = not yet known,
 * in which case both shapes are accepted and the script says which it saw.
 */
function noRoutingExpectation(thinPath) {
  if (thinPath === true) {
    return {
      rows: 1,
      shape: { channel: CHANNEL_NONE, status: 'SKIPPED', code: 'NB_NO_ROUTING' },
      reason: 'the resolution stage records a channel-less SKIPPED row for an event nothing routes',
    };
  }
  if (thinPath === false) {
    return {
      rows: 0,
      shape: null,
      reason: 'the pre-move producer emits nothing at all for a transition with no routing rows',
    };
  }
  return {
    rows: null,
    shape: { channel: CHANNEL_NONE, status: 'SKIPPED', code: 'NB_NO_ROUTING' },
    reason: 'producer path not yet observed — accept zero rows (pre-move) or one NB_NO_ROUTING row (thin)',
  };
}

module.exports = {
  // constants
  VALID_CHANNELS,
  NON_NOTIFIABLE,
  BARE_ACTORS,
  CHANNEL_NONE,
  PGR_EVENT_PREFIX,
  MASTERS,
  SOURCE,
  DELIVERED_STATUSES,
  // source selection
  selectSource,
  schemaCodeFor,
  mdmsModuleMaster,
  // eventName
  parseEventName,
  eventNameFor,
  ledgerEventNameFor,
  // audiences
  isSchemeRef,
  audienceRef,
  parseAudience,
  audienceLabel,
  resolveAudience,
  rowMatchesTerm,
  rowMatchesAudience,
  buildAudienceIndex,
  joinedAudience,
  // expect matrix
  buildExpectRows,
  specsFor,
  tupleCount,
  // channels
  channelPolicyFrom,
  policyFor,
  channelExpectation,
  judgeRow,
  providerTemplateCounter,
  // dispatch rows
  parseTransactionId,
  noRoutingExpectation,
  // internals worth testing
  isActive,
};
