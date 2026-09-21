'use strict';
/*
 * ============================================================================
 * notif-config.test.js — node --test, no server, no Docker, no network
 * ============================================================================
 *
 *   cd local-setup/tests/e2e/notifications && node --test notif-config.test.js
 *
 * These cover the decisions the e2e scripts make BEFORE they touch a server:
 * which namespace serves a tenant, what an eventName means, which audience
 * group a scheme reference asserts on, and what status a dispatch row should
 * carry for a given channel policy. Those are the parts that used to be
 * un-runnable off a DIGIT host, which is precisely why they were the parts
 * that went wrong.
 * ============================================================================
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('./notif-config');

// ---------------------------------------------------------------------------
// eventName parsing
// ---------------------------------------------------------------------------
test('parseEventName splits COMPLAINTS.WORKFLOW.<ACTION>.<TOSTATE>', () => {
  assert.deepEqual(C.parseEventName('COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME'), {
    prefix: 'COMPLAINTS.WORKFLOW',
    action: 'ASSIGN',
    toState: 'PENDINGATLME',
  });
});

test('parseEventName disambiguates the two RATE outcomes', () => {
  const a = C.parseEventName('COMPLAINTS.WORKFLOW.RATE.CLOSEDAFTERRESOLUTION');
  const b = C.parseEventName('COMPLAINTS.WORKFLOW.RATE.CLOSEDAFTERREJECTION');
  assert.equal(a.action, 'RATE');
  assert.equal(b.action, 'RATE');
  assert.notEqual(a.toState, b.toState);
});

test('parseEventName takes the last two segments of any module prefix', () => {
  assert.deepEqual(C.parseEventName('TL.APPLICATION.WORKFLOW.APPROVE.APPROVED'), {
    prefix: 'TL.APPLICATION.WORKFLOW',
    action: 'APPROVE',
    toState: 'APPROVED',
  });
});

test('parseEventName refuses to guess rather than inventing an (action,toState)', () => {
  // Three segments cannot be split into prefix + action + toState without
  // guessing which of them is the prefix, and the dispatch log is parsed on
  // exactly that pair — so null, not a best effort.
  assert.equal(C.parseEventName('COMPLAINTS.WORKFLOW.APPLY'), null);
  assert.equal(C.parseEventName(''), null);
  assert.equal(C.parseEventName(null), null);
});

test('eventNameFor / ledgerEventNameFor round-trip the config key and the ledger label', () => {
  assert.equal(C.eventNameFor('assign', 'pendingatlme'), 'COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME');
  assert.equal(C.eventNameFor('APPLY', ''), null);
  // The ledger's event_name deliberately has NO toState (errata: confirmed as designed).
  assert.equal(C.ledgerEventNameFor('ASSIGN'), 'COMPLAINTS.WORKFLOW.ASSIGN');
});

// ---------------------------------------------------------------------------
// Audience scheme -> audience group
// ---------------------------------------------------------------------------
test('audienceRef maps the legacy bare-name table (design 2.3)', () => {
  assert.equal(C.audienceRef('CITIZEN'), 'ACTOR:citizen');
  assert.equal(C.audienceRef('EMPLOYEE'), 'ACTOR:assignee');
  assert.equal(C.audienceRef('GRO'), 'ROLE:GRO');
  assert.equal(C.audienceRef('GRO', true), 'ACTOR:assignee|ROLE:GRO');
  assert.equal(C.audienceRef('AUTO_ESCALATE'), null);
  assert.equal(C.audienceRef('SYSTEM'), null);
});

test('audienceRef leaves an already-converted reference alone (re-conversion is a no-op)', () => {
  for (const ref of ['ACTOR:citizen', 'ROLE:PGR_LME', 'ACTOR:assignee|ROLE:GRO', 'EVENT_RECIPIENTS']) {
    assert.equal(C.audienceRef(ref), ref);
    assert.equal(C.audienceRef(ref, true), ref);
  }
});

test('parseAudience resolves ACTOR:citizen to the citizen', () => {
  const a = C.parseAudience('ACTOR:citizen');
  assert.equal(a.terms.length, 1);
  assert.deepEqual({ scheme: a.terms[0].scheme, name: a.terms[0].name }, { scheme: 'ACTOR', name: 'citizen' });
  assert.equal(a.label, 'CITIZEN');
});

test('parseAudience resolves ACTOR:assignee to the assignee, not to a role pool', () => {
  const a = C.parseAudience('ACTOR:assignee');
  assert.equal(a.terms[0].scheme, 'ACTOR');
  assert.equal(a.terms[0].name, 'assignee');
  assert.equal(a.label, 'ASSIGNEE');
});

test('parseAudience resolves ROLE:<code> to holders of that role', () => {
  const a = C.parseAudience('ROLE:PGR_LME');
  assert.equal(a.terms[0].scheme, 'ROLE');
  assert.equal(a.terms[0].name, 'PGR_LME');
  assert.equal(a.label, 'PGR_LME');
});

test('parseAudience keeps a pipe chain ordered', () => {
  const a = C.parseAudience('ACTOR:assignee|ROLE:GRO');
  assert.equal(a.terms.length, 2);
  assert.equal(a.terms[0].scheme, 'ACTOR');
  assert.equal(a.terms[1].scheme, 'ROLE');
  assert.equal(a.terms[1].name, 'GRO');
  assert.equal(a.label, 'ASSIGNEE|GRO');
});

test('parseAudience accepts a legacy bare name wherever a reference is legal', () => {
  assert.equal(C.parseAudience('CITIZEN').terms[0].name, 'citizen');
  assert.equal(C.parseAudience('GRO').terms[0].scheme, 'ROLE');
  assert.equal(C.parseAudience('GRO', true).label, 'ASSIGNEE|GRO');
});

test('parseAudience reports an unknown scheme instead of guessing at it', () => {
  const a = C.parseAudience('WARD:12|ROLE:GRO');
  assert.equal(a.terms[0].scheme, 'UNKNOWN');
  assert.equal(a.terms[1].scheme, 'ROLE');
});

test('parseAudience marks a non-notifiable audience unnotifiable', () => {
  const a = C.parseAudience('SYSTEM');
  assert.equal(a.notifiable, false);
  assert.equal(a.ref, null);
});

test('resolveAudience picks the FIRST term of a chain that resolves', () => {
  const terms = C.parseAudience('ACTOR:assignee|ROLE:GRO').terms;
  const withAssignee = C.resolveAudience(terms, {
    hasActor: (n) => n === 'assignee',
    roleHolderCount: () => 5,
  });
  assert.equal(withAssignee.term.scheme, 'ACTOR');

  const withoutAssignee = C.resolveAudience(terms, {
    hasActor: () => false,
    roleHolderCount: (r) => (r === 'GRO' ? 3 : 0),
  });
  assert.equal(withoutAssignee.term.scheme, 'ROLE');
  assert.equal(withoutAssignee.term.name, 'GRO');

  const neither = C.resolveAudience(terms, { hasActor: () => false, roleHolderCount: () => 0 });
  assert.equal(neither.term, null);
});

test('rowMatchesTerm checks the citizen by uuid and the assignee by uuid when known', () => {
  const ctx = { citizenUuid: 'c-1', assigneeUuid: 'e-1', rolesOf: () => new Set(['EMPLOYEE']) };
  const citizen = C.parseAudience('ACTOR:citizen').terms[0];
  const assignee = C.parseAudience('ACTOR:assignee').terms[0];
  assert.equal(C.rowMatchesTerm(citizen, { uuid: 'c-1' }, ctx), true);
  assert.equal(C.rowMatchesTerm(citizen, { uuid: 'e-1' }, ctx), false);
  assert.equal(C.rowMatchesTerm(assignee, { uuid: 'e-1' }, ctx), true);
  // The citizen must never satisfy the assignee audience, even holding EMPLOYEE.
  assert.equal(C.rowMatchesTerm(assignee, { uuid: 'c-1' }, ctx), false);
});

test('rowMatchesTerm falls back to the pre-move EMPLOYEE check when no assignee is known', () => {
  const ctx = {
    citizenUuid: 'c-1',
    assigneeUuid: null,
    rolesOf: (u) => new Set(u === 'e-1' ? ['EMPLOYEE', 'GRO'] : []),
  };
  const assignee = C.parseAudience('ACTOR:assignee').terms[0];
  assert.equal(C.rowMatchesTerm(assignee, { uuid: 'e-1' }, ctx), true);
  assert.equal(C.rowMatchesTerm(assignee, { uuid: 'x-9' }, ctx), false);
});

test('rowMatchesTerm checks a ROLE term against the recipient real roles', () => {
  const ctx = { citizenUuid: 'c-1', assigneeUuid: null, rolesOf: (u) => new Set(u === 'g-1' ? ['GRO'] : []) };
  const gro = C.parseAudience('ROLE:GRO').terms[0];
  assert.equal(C.rowMatchesTerm(gro, { uuid: 'g-1' }, ctx), true);
  assert.equal(C.rowMatchesTerm(gro, { uuid: 'nope' }, ctx), false);
});

// ---------------------------------------------------------------------------
// The audience-index join (the hazard notifications_convert.py documents)
// ---------------------------------------------------------------------------
test('the audience index keeps a template row on the same audience string routing produced', () => {
  const routing = [
    { audience: 'GRO', assigneeOnly: true, action: 'ASSIGN', toState: 'PENDINGATLME', channel: 'SMS' },
  ];
  const index = C.buildAudienceIndex(routing);
  const templateRow = { audience: 'GRO', action: 'ASSIGN', toState: 'PENDINGATLME', channel: 'SMS' };
  assert.equal(C.joinedAudience(templateRow, index), 'ACTOR:assignee|ROLE:GRO');
  // Without the index the join silently breaks into a bare ROLE:GRO.
  assert.equal(C.joinedAudience(templateRow, null), 'ROLE:GRO');
});

// ---------------------------------------------------------------------------
// Source selection
// ---------------------------------------------------------------------------
test('selectSource serves NOTIFICATIONS.* as soon as the tenant has routing rows there', () => {
  assert.equal(C.selectSource(41), C.SOURCE.NEXT);
  assert.equal(C.selectSource(1), C.SOURCE.NEXT);
});

test('selectSource falls back to the legacy namespace for a tenant with zero new rows', () => {
  assert.equal(C.selectSource(0), C.SOURCE.LEGACY);
  assert.equal(C.selectSource(null), C.SOURCE.LEGACY);
  assert.equal(C.selectSource(undefined), C.SOURCE.LEGACY);
  assert.equal(C.selectSource('nonsense'), C.SOURCE.LEGACY);
});

test('schemaCodeFor gives the right MDMS code per source, and no legacy catalogue', () => {
  assert.equal(C.schemaCodeFor('Routing', C.SOURCE.NEXT), 'NOTIFICATIONS.Routing');
  assert.equal(C.schemaCodeFor('Routing', C.SOURCE.LEGACY), 'RAINMAKER-PGR.NotificationRouting');
  assert.equal(C.schemaCodeFor('Channel', C.SOURCE.LEGACY), 'RAINMAKER-PGR.NotificationChannel');
  // EventCatalogue is new: there is nothing to fall back to, and returning a
  // legacy code would produce a search that silently answers [].
  assert.equal(C.schemaCodeFor('EventCatalogue', C.SOURCE.LEGACY), null);
  assert.throws(() => C.schemaCodeFor('Nope', C.SOURCE.NEXT));
});

test('mdmsModuleMaster splits a schema code for a v1-compat search', () => {
  assert.deepEqual(C.mdmsModuleMaster('Template', C.SOURCE.NEXT), {
    moduleName: 'NOTIFICATIONS',
    masterName: 'Template',
  });
  assert.deepEqual(C.mdmsModuleMaster('Template', C.SOURCE.LEGACY), {
    moduleName: 'RAINMAKER-PGR',
    masterName: 'NotificationTemplate',
  });
});

// ---------------------------------------------------------------------------
// The EXPECT matrix, from both namespaces
// ---------------------------------------------------------------------------
const LEGACY_ROWS = [
  { businessService: 'PGR', action: 'APPLY', toState: 'PENDINGFORASSIGNMENT', audience: 'CITIZEN', channel: 'SMS' },
  { businessService: 'PGR', action: 'APPLY', toState: 'PENDINGFORASSIGNMENT', audience: 'CITIZEN', channel: 'EMAIL' },
  { businessService: 'PGR', action: 'ASSIGN', toState: 'PENDINGATLME', audience: 'EMPLOYEE', channel: 'SMS' },
  { businessService: 'PGR', action: 'ASSIGN', toState: 'PENDINGATLME', audience: 'GRO', assigneeOnly: true, channel: 'SMS' },
  { businessService: 'PGR', action: 'ASSIGN', toState: 'PENDINGATLME', audience: 'SYSTEM', channel: 'SMS' },
  { businessService: 'PGR', action: 'ASSIGN', toState: 'PENDINGATLME', audience: 'CITIZEN', channel: 'PIGEON' },
  { businessService: 'TL', action: 'APPLY', toState: 'APPLIED', audience: 'CITIZEN', channel: 'SMS' },
  { businessService: 'PGR', action: 'APPLY', toState: 'PENDINGFORASSIGNMENT', audience: 'CITIZEN', channel: 'SMS', active: false },
];

const NEW_ROWS = [
  { module: 'Complaints', eventName: 'COMPLAINTS.WORKFLOW.APPLY.PENDINGFORASSIGNMENT', audience: 'ACTOR:citizen', channel: 'SMS' },
  { module: 'Complaints', eventName: 'COMPLAINTS.WORKFLOW.APPLY.PENDINGFORASSIGNMENT', audience: 'ACTOR:citizen', channel: 'EMAIL' },
  { module: 'Complaints', eventName: 'COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME', audience: 'ACTOR:assignee', channel: 'SMS' },
  { module: 'Complaints', eventName: 'COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME', audience: 'ACTOR:assignee|ROLE:GRO', channel: 'SMS' },
  { module: 'Complaints', eventName: 'COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME', audience: 'ACTOR:citizen', channel: 'PIGEON' },
  { module: 'Complaints', eventName: 'NOT_A_VALID_NAME', audience: 'ACTOR:citizen', channel: 'SMS' },
  { module: 'Complaints', eventName: 'COMPLAINTS.WORKFLOW.APPLY.PENDINGFORASSIGNMENT', audience: 'ACTOR:citizen', channel: 'SMS', active: false },
];

test('buildExpectRows on the legacy namespace replays the router filters', () => {
  const { rows, skipped } = C.buildExpectRows({ source: C.SOURCE.LEGACY, rows: LEGACY_ROWS, businessService: 'PGR' });
  const keys = rows.map((r) => `${r.action}|${r.toState}|${r.audience}|${r.channel}`).sort();
  assert.deepEqual(keys, [
    'APPLY|PENDINGFORASSIGNMENT|ACTOR:citizen|EMAIL',
    'APPLY|PENDINGFORASSIGNMENT|ACTOR:citizen|SMS',
    'ASSIGN|PENDINGATLME|ACTOR:assignee|ROLE:GRO|SMS',
    'ASSIGN|PENDINGATLME|ACTOR:assignee|SMS',
  ]);
  // SYSTEM and PIGEON were dropped with a reason, not silently.
  assert.ok(skipped.some(([, why]) => /not notifiable/.test(why)));
  assert.ok(skipped.some(([, why]) => /PIGEON/.test(why)));
});

test('buildExpectRows on NOTIFICATIONS.* produces the SAME matrix from eventName', () => {
  const legacy = C.buildExpectRows({ source: C.SOURCE.LEGACY, rows: LEGACY_ROWS, businessService: 'PGR' }).rows;
  const next = C.buildExpectRows({ source: C.SOURCE.NEXT, rows: NEW_ROWS }).rows;
  const key = (r) => `${r.action}|${r.toState}|${r.audience}|${r.channel}`;
  assert.deepEqual(next.map(key).sort(), legacy.map(key).sort());
});

test('buildExpectRows reports an unsplittable eventName instead of dropping it silently', () => {
  const { skipped } = C.buildExpectRows({ source: C.SOURCE.NEXT, rows: NEW_ROWS });
  assert.ok(skipped.some(([, why]) => /NOT_A_VALID_NAME/.test(why)));
});

test('specsFor / tupleCount group the matrix per transition', () => {
  const rows = C.buildExpectRows({ source: C.SOURCE.NEXT, rows: NEW_ROWS }).rows;
  const apply = C.specsFor(rows, 'APPLY', 'PENDINGFORASSIGNMENT');
  assert.equal(apply.length, 1);
  assert.deepEqual(apply[0].channels.sort(), ['EMAIL', 'SMS']);
  assert.equal(C.tupleCount(rows, 'APPLY', 'PENDINGFORASSIGNMENT'), 2);
  assert.equal(C.tupleCount(rows, 'ESCALATE', 'ESCALATED'), 0);
});

// ---------------------------------------------------------------------------
// Channel policy + the WhatsApp expectation table
// ---------------------------------------------------------------------------
test('channelPolicyFrom prefers NOTIFICATIONS.Channel rows', () => {
  const p = C.channelPolicyFrom({
    newRows: [{ code: 'SMS', enabled: true, provider: 'twilio-sms-1' }],
    legacyRows: [{ code: 'SMS', enabled: false }],
  });
  assert.equal(p.source, 'NOTIFICATIONS.Channel');
  assert.equal(p.byChannel.SMS.enabled, true);
  assert.equal(p.byChannel.SMS.provider, 'twilio-sms-1');
});

test('channelPolicyFrom falls back per tenant to the legacy channel master', () => {
  const p = C.channelPolicyFrom({ newRows: [], legacyRows: [{ code: 'SMS', enabled: true }] });
  assert.equal(p.source, 'RAINMAKER-PGR.NotificationChannel');
  assert.equal(p.byChannel.SMS.enabled, true);
});

test('a tenant WITH rows gets no env leakage — a channel with no row is off', () => {
  const p = C.channelPolicyFrom({
    newRows: [{ code: 'SMS', enabled: true }],
    envEnabled: ['SMS', 'EMAIL', 'WHATSAPP'],
  });
  assert.equal(p.byChannel.EMAIL.enabled, false);
  assert.equal(p.byChannel.WHATSAPP.enabled, false);
});

test('a tenant with NO rows at all falls back to the env allowlist, which defaults to empty', () => {
  const withEnv = C.channelPolicyFrom({ newRows: [], legacyRows: [], envEnabled: ['SMS', 'EMAIL'] });
  assert.equal(withEnv.source, 'env:novu.bridge.channels.enabled');
  assert.equal(withEnv.byChannel.SMS.enabled, true);
  assert.equal(withEnv.byChannel.WHATSAPP.enabled, false);

  const bare = C.channelPolicyFrom({});
  assert.equal(bare.byChannel.SMS.enabled, false);
});

test('an inactive channel row is not a policy row at all', () => {
  const p = C.channelPolicyFrom({ newRows: [{ code: 'SMS', enabled: true, active: false }], envEnabled: ['EMAIL'] });
  assert.equal(p.source, 'env:novu.bridge.channels.enabled');
  assert.equal(p.byChannel.EMAIL.enabled, true);
});

test('WhatsApp expectation: channel disabled -> SKIPPED / NB_NO_PROVIDER', () => {
  const policy = C.channelPolicyFrom({ newRows: [{ code: 'SMS', enabled: true }] });
  const e = C.channelExpectation({ channel: 'WHATSAPP', policy, approvedProviderTemplates: 3 });
  assert.equal(e.status, 'SKIPPED');
  assert.equal(e.code, 'NB_NO_PROVIDER');
});

test('WhatsApp expectation: enabled with no approved provider template -> NB_TEMPLATE_NOT_APPROVED', () => {
  const policy = C.channelPolicyFrom({ newRows: [{ code: 'WHATSAPP', enabled: true, provider: 'twilio-whatsapp-1' }] });
  const e = C.channelExpectation({ channel: 'WHATSAPP', policy, approvedProviderTemplates: 0 });
  assert.equal(e.status, 'SKIPPED');
  assert.equal(e.code, 'NB_TEMPLATE_NOT_APPROVED');
});

test('WhatsApp expectation: enabled, template approved, provider unusable -> NB_PROVIDER_UNAVAILABLE', () => {
  const policy = C.channelPolicyFrom({ newRows: [{ code: 'WHATSAPP', enabled: true, provider: 'twilio-whatsapp-1' }] });
  const e = C.channelExpectation({
    channel: 'WHATSAPP',
    policy,
    approvedProviderTemplates: 2,
    providerUsable: false,
  });
  assert.equal(e.status, 'SKIPPED');
  assert.equal(e.code, 'NB_PROVIDER_UNAVAILABLE');
});

test('WhatsApp expectation: template gate runs BEFORE the provider gate, as the pipeline does', () => {
  const policy = C.channelPolicyFrom({ newRows: [{ code: 'WHATSAPP', enabled: true, provider: 'twilio-whatsapp-1' }] });
  const e = C.channelExpectation({
    channel: 'WHATSAPP',
    policy,
    approvedProviderTemplates: 0,
    providerUsable: false,
  });
  assert.equal(e.code, 'NB_TEMPLATE_NOT_APPROVED');
  assert.ok(e.tolerate.some((t) => t.code === 'NB_PROVIDER_UNAVAILABLE'));
});

test('WhatsApp expectation: everything in place -> SENT (the operator switched it on)', () => {
  const policy = C.channelPolicyFrom({ newRows: [{ code: 'WHATSAPP', enabled: true, provider: 'twilio-whatsapp-1' }] });
  const e = C.channelExpectation({
    channel: 'WHATSAPP',
    policy,
    approvedProviderTemplates: 1,
    providerUsable: true,
  });
  assert.equal(e.status, 'SENT');
  assert.equal(e.code, null);
});

test('SMS never needs an approved provider template', () => {
  const policy = C.channelPolicyFrom({ newRows: [{ code: 'SMS', enabled: true }] });
  const e = C.channelExpectation({ channel: 'SMS', policy, approvedProviderTemplates: 0, providerUsable: true });
  assert.equal(e.status, 'SENT');
});

test('NB_CONTACT_MISSING is an accepted outcome on every channel expectation', () => {
  const policy = C.channelPolicyFrom({ newRows: [{ code: 'SMS', enabled: true }, { code: 'WHATSAPP', enabled: false }] });
  for (const channel of ['SMS', 'WHATSAPP']) {
    const e = C.channelExpectation({ channel, policy, approvedProviderTemplates: 0, providerUsable: true });
    const tolerated = e.code === 'NB_NO_PROVIDER' ? [] : e.tolerate;
    if (e.code !== 'NB_NO_PROVIDER') {
      assert.ok(tolerated.some((t) => t.code === 'NB_CONTACT_MISSING'), `${channel} must tolerate NB_CONTACT_MISSING`);
    }
  }
});

test('an unprobed provider makes NB_PROVIDER_UNAVAILABLE a WARNING, never a silent pass', () => {
  const policy = C.channelPolicyFrom({ newRows: [{ code: 'SMS', enabled: true, provider: 'twilio-sms-1' }] });
  const e = C.channelExpectation({ channel: 'SMS', policy, providerUsable: null });
  const t = e.tolerate.find((x) => x.code === 'NB_PROVIDER_UNAVAILABLE');
  assert.ok(t, 'unprobed provider must leave NB_PROVIDER_UNAVAILABLE tolerated');
  assert.equal(t.warn, true);
});

test('judgeRow separates match, tolerated and mismatch', () => {
  const policy = C.channelPolicyFrom({ newRows: [{ code: 'WHATSAPP', enabled: false }] });
  const e = C.channelExpectation({ channel: 'WHATSAPP', policy });
  assert.equal(C.judgeRow(e, { status: 'SKIPPED', lastError: 'NB_NO_PROVIDER' }).verdict, 'match');
  assert.equal(C.judgeRow(e, { status: 'SENT', lastError: '' }).verdict, 'mismatch');

  const sent = C.channelExpectation({
    channel: 'SMS',
    policy: C.channelPolicyFrom({ newRows: [{ code: 'SMS', enabled: true }] }),
    providerUsable: true,
  });
  assert.equal(C.judgeRow(sent, { status: 'SENT', lastError: '' }).verdict, 'match');
  assert.equal(C.judgeRow(sent, { status: 'DELIVERED', lastError: '' }).verdict, 'match');
  assert.equal(C.judgeRow(sent, { status: 'SKIPPED', lastError: 'NB_CONTACT_MISSING' }).verdict, 'tolerated');
  assert.equal(C.judgeRow(sent, { status: 'FAILED', lastError: 'NB_NOVU_TRIGGER_FAILED' }).verdict, 'mismatch');
});

// ---------------------------------------------------------------------------
// Provider-template counting
// ---------------------------------------------------------------------------
test('providerTemplateCounter counts approved rows from either namespace', () => {
  const legacyRouting = [{ audience: 'GRO', assigneeOnly: true, action: 'ASSIGN', toState: 'PENDINGATLME', channel: 'WHATSAPP' }];
  const index = C.buildAudienceIndex(legacyRouting);
  const legacy = C.providerTemplateCounter({
    source: C.SOURCE.LEGACY,
    audienceIndex: index,
    rows: [
      { provider: 'twilio', channel: 'WHATSAPP', action: 'ASSIGN', toState: 'PENDINGATLME', audience: 'GRO', locale: 'en_IN', approvalStatus: 'approved' },
      { provider: 'twilio', channel: 'WHATSAPP', action: 'ASSIGN', toState: 'PENDINGATLME', audience: 'GRO', locale: 'hi_IN', approvalStatus: 'pending' },
    ],
  });
  assert.equal(legacy('ASSIGN', 'PENDINGATLME', 'ACTOR:assignee|ROLE:GRO', 'WHATSAPP'), 1);
  assert.equal(legacy('ASSIGN', 'PENDINGATLME', 'ROLE:GRO', 'WHATSAPP'), 0);

  const next = C.providerTemplateCounter({
    source: C.SOURCE.NEXT,
    rows: [
      { provider: 'twilio', channel: 'WHATSAPP', eventName: 'COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME', audience: 'ACTOR:assignee|ROLE:GRO', locale: 'en_IN', approvalStatus: 'approved' },
    ],
  });
  assert.equal(next('ASSIGN', 'PENDINGATLME', 'ACTOR:assignee|ROLE:GRO', 'WHATSAPP'), 1);
});

// ---------------------------------------------------------------------------
// transaction_id + the E2E-4 expectation
// ---------------------------------------------------------------------------
test('parseTransactionId keeps the six-part shape the script has always parsed', () => {
  const t = C.parseTransactionId('PGR-2026-000123:ASSIGN:PENDINGATLME:ke.bomet:9a1f-uuid:SMS');
  assert.equal(t.action, 'ASSIGN');
  assert.equal(t.toState, 'PENDINGATLME');
  assert.equal(t.uuid, '9a1f-uuid');
  assert.equal(t.channel, 'SMS');
  assert.equal(t.channelLess, false);
  assert.equal(t.wellFormed, true);
});

test('parseTransactionId understands the channel-less <seed>:NONE row', () => {
  const t = C.parseTransactionId('PGR-2026-000123:ESCALATE:ESCALATED:NONE');
  assert.equal(t.action, 'ESCALATE');
  assert.equal(t.toState, 'ESCALATED');
  assert.equal(t.channel, 'NONE');
  assert.equal(t.channelLess, true);
  assert.equal(t.uuid, '');
  assert.equal(t.wellFormed, true);
});

test('parseTransactionId flags a shape that is neither', () => {
  assert.equal(C.parseTransactionId('garbage').wellFormed, false);
  assert.equal(C.parseTransactionId('a:b:c:d:e').wellFormed, false);
});

test('E2E-4: no routing now means ONE channel-less NB_NO_ROUTING row on the thin path', () => {
  const thin = C.noRoutingExpectation(true);
  assert.equal(thin.rows, 1);
  assert.deepEqual(thin.shape, { channel: 'NONE', status: 'SKIPPED', code: 'NB_NO_ROUTING' });
});

test('E2E-4: the pre-move producer still legitimately writes nothing', () => {
  assert.equal(C.noRoutingExpectation(false).rows, 0);
  assert.equal(C.noRoutingExpectation(false).shape, null);
});

test('E2E-4: an unobserved producer path accepts either shape and says so', () => {
  const unknown = C.noRoutingExpectation(null);
  assert.equal(unknown.rows, null);
  assert.ok(/pre-move|thin/.test(unknown.reason));
});
