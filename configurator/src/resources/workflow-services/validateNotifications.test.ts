import { describe, it, expect } from 'vitest';
import {
  validateNotifications,
  scanPlaceholders,
  placeholderTokens,
  resolveProviderTemplate,
  NOTIFICATION_RULES,
  EMAIL_SUBJECT_MAX,
  type BusinessServiceRecord,
  type RoutingRow,
  type TemplateRow,
} from './validateNotifications';

const PGR: BusinessServiceRecord = {
  businessService: 'PGR',
  states: [
    {
      state: 'PENDINGFORASSIGNMENT',
      actions: [
        { action: 'ASSIGN', nextState: 'PENDINGATLME', roles: ['GRO', 'PGR_LME'] },
      ],
    },
    {
      state: 'PENDINGATLME',
      actions: [
        { action: 'RESOLVE', nextState: 'RESOLVED', roles: ['PGR_LME'] },
        { action: 'REJECT', nextState: 'REJECTED', roles: ['PGR_LME'] },
      ],
    },
  ],
};

// Live workflow-v2 shape: action.nextState is the target state's UUID (not a
// symbolic name). The checker must resolve UUID -> applicationStatus before
// keying the transition set, otherwise every routing row (which stores the
// status NAME in toState) would false-positive on R4. Mirrors the real PGR
// business-service record the Configure tab loads.
const PGR_LIVE: BusinessServiceRecord = {
  businessService: 'PGR',
  states: [
    {
      uuid: 'uuid-pfa',
      state: 'PENDINGFORASSIGNMENT',
      applicationStatus: 'PENDINGFORASSIGNMENT',
      actions: [{ action: 'ASSIGN', nextState: 'uuid-lme', roles: ['GRO'] }],
    },
    {
      uuid: 'uuid-lme',
      state: 'PENDINGATLME',
      applicationStatus: 'PENDINGATLME',
      actions: [{ action: 'RESOLVE', nextState: 'uuid-res', roles: ['PGR_LME'] }],
    },
    { uuid: 'uuid-res', state: 'RESOLVED', applicationStatus: 'RESOLVED', actions: [] },
  ],
};

const ROLE_CODES = ['GRO', 'PGR_LME', 'CSR'];

function template(overrides: Partial<TemplateRow> = {}): TemplateRow {
  return {
    audience: 'CITIZEN',
    action: 'ASSIGN',
    toState: 'PENDINGATLME',
    channel: 'SMS',
    locale: 'en_IN',
    body: 'hi',
    active: true,
    ...overrides,
  };
}

function routing(overrides: Partial<RoutingRow> = {}): RoutingRow {
  return {
    businessService: 'PGR',
    action: 'ASSIGN',
    toState: 'PENDINGATLME',
    audience: 'CITIZEN',
    channel: 'SMS',
    active: true,
    ...overrides,
  };
}

describe('validateNotifications', () => {
  it('returns no findings for a fully valid config', () => {
    const findings = validateNotifications({
      businessService: PGR,
      routingRows: [routing()],
      templateRows: [template()],
      roleCodes: ROLE_CODES,
    });
    expect(findings).toEqual([]);
  });

  it('R1: flags an audience that is not a known role code', () => {
    const findings = validateNotifications({
      businessService: PGR,
      routingRows: [routing({ audience: 'NONEXISTENT_ROLE' })],
      templateRows: [template({ audience: 'NONEXISTENT_ROLE' })],
      roleCodes: ROLE_CODES,
    });
    expect(findings.some((f) => f.rule === 'audience-role-exists' && f.level === 'error')).toBe(true);
  });

  it('R1: accepts a role present on a workflow action even if absent from access-roles', () => {
    const findings = validateNotifications({
      businessService: PGR,
      routingRows: [routing({ audience: 'PGR_LME' })],
      templateRows: [template({ audience: 'PGR_LME' })],
      roleCodes: [], // not in access-roles, but PGR_LME is on an action
    });
    expect(findings.filter((f) => f.rule === 'audience-role-exists')).toHaveLength(0);
  });

  it('R2: flags an active routing row with no matching template', () => {
    const findings = validateNotifications({
      businessService: PGR,
      routingRows: [routing()],
      templateRows: [], // no templates at all
      roleCodes: ROLE_CODES,
    });
    expect(findings.some((f) => f.rule === 'routing-has-template' && f.level === 'error')).toBe(true);
  });

  it('R2: flags when only a non-default locale template exists', () => {
    const findings = validateNotifications({
      businessService: PGR,
      routingRows: [routing()],
      templateRows: [template({ locale: 'sw_KE' })],
      roleCodes: ROLE_CODES,
    });
    const f = findings.find((x) => x.rule === 'routing-has-template');
    expect(f?.level).toBe('error');
    expect(f?.message).toMatch(/another locale/);
  });

  it('R3: flags a disallowed channel', () => {
    const findings = validateNotifications({
      businessService: PGR,
      routingRows: [routing({ channel: 'PIGEON' })],
      templateRows: [template({ channel: 'PIGEON' })],
      roleCodes: ROLE_CODES,
    });
    expect(findings.some((f) => f.rule === 'channel-allowed' && f.level === 'error')).toBe(true);
  });

  it('R4: flags a routing transition that does not exist in the workflow', () => {
    const findings = validateNotifications({
      businessService: PGR,
      routingRows: [routing({ action: 'ASSIGN', toState: 'GHOSTSTATE' })],
      templateRows: [template({ action: 'ASSIGN', toState: 'GHOSTSTATE' })],
      roleCodes: ROLE_CODES,
    });
    expect(findings.some((f) => f.rule === 'transition-exists' && f.level === 'error')).toBe(true);
  });

  it('R5: warns about an orphan template with no matching routing', () => {
    const findings = validateNotifications({
      businessService: PGR,
      routingRows: [routing()],
      templateRows: [
        template(),
        template({ action: 'RESOLVE', toState: 'RESOLVED', channel: 'EMAIL' }),
      ],
      roleCodes: ROLE_CODES,
    });
    expect(findings.some((f) => f.rule === 'no-orphan-template' && f.level === 'warn')).toBe(true);
  });

  it('R6: warns about a non-notifiable audience', () => {
    const findings = validateNotifications({
      businessService: PGR,
      routingRows: [routing({ audience: 'AUTO_ESCALATE' })],
      templateRows: [template({ audience: 'AUTO_ESCALATE' })],
      roleCodes: ROLE_CODES,
    });
    expect(findings.some((f) => f.rule === 'non-notifiable-audience' && f.level === 'warn')).toBe(true);
    // R1 must NOT also fire for a non-notifiable pseudo-audience.
    expect(findings.filter((f) => f.rule === 'audience-role-exists')).toHaveLength(0);
  });

  it('compares case-insensitively', () => {
    const findings = validateNotifications({
      businessService: PGR,
      routingRows: [routing({ audience: 'pgr_lme', action: 'assign', toState: 'pendingatlme', channel: 'sms' })],
      templateRows: [template({ audience: 'pgr_lme', channel: 'sms' })],
      roleCodes: ROLE_CODES,
    });
    expect(findings).toEqual([]);
  });

  it('ignores inactive routing rows for template presence', () => {
    const findings = validateNotifications({
      businessService: PGR,
      routingRows: [routing({ active: false })],
      templateRows: [],
      roleCodes: ROLE_CODES,
    });
    expect(findings.filter((f) => f.rule === 'routing-has-template')).toHaveLength(0);
  });

  // CFG-1 (gap G8): exercise the UUID-resolution branch that stays dead when
  // every fixture uses symbolic nextState names. Against PGR_LIVE the workflow
  // actions carry UUID nextStates, so statusByStateUuid is non-empty and
  // resolveState actually maps uuid -> applicationStatus.
  it('CFG-1 R4: does not false-positive on a valid transition when workflow nextState is a UUID', () => {
    // routing() defaults are ASSIGN -> PENDINGATLME (the applicationStatus name),
    // which is exactly how the Configure tab writes the row. The workflow stores
    // ASSIGN -> uuid-lme; resolveState must bridge the two.
    const findings = validateNotifications({
      businessService: PGR_LIVE,
      routingRows: [routing()],
      templateRows: [template()],
      roleCodes: ROLE_CODES,
    });
    expect(findings.filter((f) => f.rule === 'transition-exists')).toHaveLength(0);
  });

  it('CFG-1 R4: fires when a routing row stores the raw UUID instead of the applicationStatus name', () => {
    // Operators must store the status NAME. A raw uuid-lme is the regression the
    // resolution exists to catch: the transition key becomes ASSIGN|UUID-LME and
    // never matches the resolved ASSIGN|PENDINGATLME.
    const findings = validateNotifications({
      businessService: PGR_LIVE,
      routingRows: [routing({ action: 'ASSIGN', toState: 'uuid-lme' })],
      templateRows: [template({ action: 'ASSIGN', toState: 'uuid-lme' })],
      roleCodes: ROLE_CODES,
    });
    const te = findings.filter((f) => f.rule === 'transition-exists');
    expect(te).toHaveLength(1);
    expect(te[0].level).toBe('error');
  });

  it('CFG-1 R4: fires on a resolved-set miss and on a UUID that resolves to nowhere', () => {
    // (a) A real status, but not ASSIGN's resolved target — proves the UUID
    //     resolution did not over-broaden the transition set.
    const missResolved = validateNotifications({
      businessService: PGR_LIVE,
      routingRows: [routing({ action: 'ASSIGN', toState: 'RESOLVED' })],
      templateRows: [template({ action: 'ASSIGN', toState: 'RESOLVED' })],
      roleCodes: ROLE_CODES,
    });
    expect(missResolved.filter((f) => f.rule === 'transition-exists')).toHaveLength(1);

    // (b) GHOST -> uuid-nowhere: resolveState falls back to the raw uuid
    //     (statusByStateUuid.get(ns) || ns), so the transition key is
    //     GHOST|UUID-NOWHERE and a routing row keyed GHOST|PENDINGATLME never
    //     matches a real workflow transition.
    const withGhost: BusinessServiceRecord = {
      businessService: 'PGR',
      states: [
        ...(PGR_LIVE.states ?? []),
        {
          uuid: 'uuid-ghost',
          state: 'GHOSTORIGIN',
          applicationStatus: 'GHOSTORIGIN',
          actions: [{ action: 'GHOST', nextState: 'uuid-nowhere', roles: ['GRO'] }],
        },
      ],
    };
    const missGhost = validateNotifications({
      businessService: withGhost,
      routingRows: [routing({ action: 'GHOST', toState: 'PENDINGATLME' })],
      templateRows: [template({ action: 'GHOST', toState: 'PENDINGATLME' })],
      roleCodes: ROLE_CODES,
    });
    expect(missGhost.filter((f) => f.rule === 'transition-exists')).toHaveLength(1);
  });

  it('CFG-1: a full clean config passes against the live (UUID-nextState) shape', () => {
    const routingRows = [
      routing({ action: 'ASSIGN', toState: 'PENDINGATLME', audience: 'CITIZEN', channel: 'SMS' }),
      routing({ action: 'ASSIGN', toState: 'PENDINGATLME', audience: 'GRO', channel: 'EMAIL' }),
      routing({ action: 'RESOLVE', toState: 'RESOLVED', audience: 'CITIZEN', channel: 'SMS' }),
    ];
    const templateRows = [
      template({ action: 'ASSIGN', toState: 'PENDINGATLME', audience: 'CITIZEN', channel: 'SMS' }),
      template({ action: 'ASSIGN', toState: 'PENDINGATLME', audience: 'GRO', channel: 'EMAIL', subject: 'Complaint {id} assigned' }),
      template({ action: 'RESOLVE', toState: 'RESOLVED', audience: 'CITIZEN', channel: 'SMS' }),
    ];
    const findings = validateNotifications({
      businessService: PGR_LIVE,
      routingRows,
      templateRows,
      roleCodes: ROLE_CODES,
    });
    expect(findings).toEqual([]);
  });
});

describe('R7 channel-enabled', () => {
  const bs = { businessService: 'PGR', states: [{ state: 'A', uuid: 'u1', applicationStatus: 'PENDINGFORASSIGNMENT', actions: [{ action: 'ASSIGN', nextState: 'u2', roles: ['GRO'] }] }, { state: 'B', uuid: 'u2', applicationStatus: 'PENDINGATLME', actions: [] }] };
  const routing = [{ businessService: 'PGR', action: 'ASSIGN', toState: 'PENDINGATLME', audience: 'CITIZEN', channel: 'SMS', active: true }];
  const template = [{ audience: 'CITIZEN', action: 'ASSIGN', toState: 'PENDINGATLME', channel: 'SMS', locale: 'en_IN', body: 'x', active: true }];

  it('is silent when no channel rows are supplied (master not seeded)', () => {
    const f = validateNotifications({ businessService: bs, routingRows: routing, templateRows: template, roleCodes: ['GRO'] });
    expect(f.filter((x) => x.rule === 'channel-enabled')).toHaveLength(0);
  });

  it('warns once per channel that is disabled or has no policy row', () => {
    const disabled = validateNotifications({ businessService: bs, routingRows: routing, templateRows: template, roleCodes: ['GRO'], channelRows: [{ code: 'SMS', enabled: false, active: true }] });
    expect(disabled.filter((x) => x.rule === 'channel-enabled').map((x) => x.level)).toEqual(['warn']);
    expect(disabled.find((x) => x.rule === 'channel-enabled')?.message).toMatch(/disabled/);
    const missing = validateNotifications({ businessService: bs, routingRows: [...routing, { ...routing[0], channel: 'SMS', audience: 'GRO' }], templateRows: template, roleCodes: ['GRO'], channelRows: [{ code: 'EMAIL', enabled: true, active: true }] });
    expect(missing.filter((x) => x.rule === 'channel-enabled')).toHaveLength(1);
    expect(missing.find((x) => x.rule === 'channel-enabled')?.message).toMatch(/no NotificationChannel row/);
  });

  it('does not warn for an enabled channel', () => {
    const f = validateNotifications({ businessService: bs, routingRows: routing, templateRows: template, roleCodes: ['GRO'], channelRows: [{ code: 'SMS', enabled: true, active: true }] });
    expect(f.filter((x) => x.rule === 'channel-enabled')).toHaveLength(0);
  });
});

describe('R8-R10 template content + WhatsApp provider template', () => {
  const bs = { businessService: 'PGR', states: [{ state: 'A', uuid: 'u1', applicationStatus: 'PENDINGFORASSIGNMENT', actions: [{ action: 'ASSIGN', nextState: 'u2', roles: ['GRO'] }] }, { state: 'B', uuid: 'u2', applicationStatus: 'PENDINGATLME', actions: [] }] };
  const base = { businessService: bs, roleCodes: ['GRO'] };

  it('flags tokens pgr-services does not fill', () => {
    const f = validateNotifications({ ...base, routingRows: [{ businessService: 'PGR', action: 'ASSIGN', toState: 'PENDINGATLME', audience: 'CITIZEN', channel: 'SMS', active: true }],
      templateRows: [{ audience: 'CITIZEN', action: 'ASSIGN', toState: 'PENDINGATLME', channel: 'SMS', locale: 'en_IN', body: 'Hi {citizen_name}, ref {ticket_no} on {date}', active: true }] });
    const u = f.find((x) => x.rule === 'unknown-token');
    expect(u?.message).toMatch(/\{ticket_no\}/);
    expect(u?.message).not.toMatch(/citizen_name\}/);
  });

  it('warns on an EMAIL template without a subject', () => {
    const f = validateNotifications({ ...base, routingRows: [{ businessService: 'PGR', action: 'ASSIGN', toState: 'PENDINGATLME', audience: 'CITIZEN', channel: 'EMAIL', active: true }],
      templateRows: [{ audience: 'CITIZEN', action: 'ASSIGN', toState: 'PENDINGATLME', channel: 'EMAIL', locale: 'en_IN', body: 'x', subject: '', active: true }] });
    expect(f.some((x) => x.rule === 'email-needs-subject')).toBe(true);
  });

  it('warns on a WHATSAPP routing row with no approved provider template, silent when one exists or rows are not supplied', () => {
    const routing = [{ businessService: 'PGR', action: 'ASSIGN', toState: 'PENDINGATLME', audience: 'CITIZEN', channel: 'WHATSAPP', active: true }];
    const template = [{ audience: 'CITIZEN', action: 'ASSIGN', toState: 'PENDINGATLME', channel: 'WHATSAPP', locale: 'en_IN', body: 'x', active: true }];
    expect(validateNotifications({ ...base, routingRows: routing, templateRows: template }).some((x) => x.rule === 'whatsapp-needs-template')).toBe(false);
    expect(validateNotifications({ ...base, routingRows: routing, templateRows: template, providerTemplateRows: [] }).some((x) => x.rule === 'whatsapp-needs-template')).toBe(true);
    expect(validateNotifications({ ...base, routingRows: routing, templateRows: template, providerTemplateRows: [{ provider: 'twilio', channel: 'WHATSAPP', audience: 'CITIZEN', action: 'ASSIGN', toState: 'PENDINGATLME', locale: 'en_IN', templateId: 'HX1', approvalStatus: 'approved', active: true }] }).some((x) => x.rule === 'whatsapp-needs-template')).toBe(false);
  });
});

describe('R7b channel provider selection', () => {
  const bs = { businessService: 'PGR', states: [{ state: 'A', uuid: 'u1', applicationStatus: 'PENDINGFORASSIGNMENT', actions: [{ action: 'ASSIGN', nextState: 'u2', roles: ['GRO'] }] }, { state: 'B', uuid: 'u2', applicationStatus: 'PENDINGATLME', actions: [] }] };
  const smsRouting = [{ businessService: 'PGR', action: 'ASSIGN', toState: 'PENDINGATLME', audience: 'CITIZEN', channel: 'SMS', active: true }];
  const smsTemplate = [{ audience: 'CITIZEN', action: 'ASSIGN', toState: 'PENDINGATLME', channel: 'SMS', locale: 'en_IN', body: 'x', active: true }];
  const base = { businessService: bs, roleCodes: ['GRO'], routingRows: smsRouting, templateRows: smsTemplate };
  const twilio = { _id: 'i1', identifier: 'twilio-sms-1', name: 'Twilio prod', active: true };
  const providerRules = ['channel-needs-provider', 'channel-provider-missing', 'channel-provider-inactive'];
  const providerFindings = (f: ReturnType<typeof validateNotifications>) => f.filter((x) => providerRules.includes(x.rule));

  it('errors when an enabled channel carrying routing rows has no provider selected', () => {
    const f = providerFindings(validateNotifications({ ...base, channelRows: [{ code: 'SMS', enabled: true, active: true }] }));
    expect(f.map((x) => [x.rule, x.level])).toEqual([['channel-needs-provider', 'error']]);
    // An absent selection still delivers through the deployment-wide fallback, so the
    // message must not claim the channel is dead: a BROKEN selection is the one the
    // bridge refuses (SKIPPED / NB_PROVIDER_UNAVAILABLE), not an absent one.
    expect(f[0].message).not.toMatch(/NB_NO_PROVIDER|NB_PROVIDER_UNAVAILABLE/);
    expect(f[0].message).toMatch(/environment settings/);
  });

  it('only warns when nothing routes on the channel yet', () => {
    const f = providerFindings(validateNotifications({ ...base, channelRows: [{ code: 'EMAIL', enabled: true, active: true }] }));
    expect(f.map((x) => [x.rule, x.level])).toEqual([['channel-needs-provider', 'warn']]);
  });

  it('is silent for a correctly selected, active provider', () => {
    const f = providerFindings(validateNotifications({ ...base, channelRows: [{ code: 'SMS', enabled: true, provider: 'twilio-sms-1', active: true }], integrationRows: [twilio] }));
    expect(f).toEqual([]);
  });

  it('reports a selection that no integration answers to', () => {
    const f = providerFindings(validateNotifications({ ...base, channelRows: [{ code: 'SMS', enabled: true, provider: 'deleted-one', active: true }], integrationRows: [twilio] }));
    expect(f.map((x) => [x.rule, x.level])).toEqual([['channel-provider-missing', 'error']]);
    expect(f[0].message).toMatch(/no longer exists/);
    // The code the operator will actually see on the Logs screen for those rows: the bridge
    // refuses to trigger a pinned integration Novu cannot deliver through.
    expect(f[0].message).toMatch(/SKIPPED \/ NB_PROVIDER_UNAVAILABLE/);
  });

  it('reports a selected provider that has been disabled, naming it', () => {
    const f = providerFindings(validateNotifications({ ...base, channelRows: [{ code: 'SMS', enabled: true, provider: 'twilio-sms-1', active: true }], integrationRows: [{ ...twilio, active: false }] }));
    expect(f.map((x) => [x.rule, x.level])).toEqual([['channel-provider-inactive', 'error']]);
    expect(f[0].message).toMatch(/Twilio prod/);
    expect(f[0].message).toMatch(/SKIPPED \/ NB_PROVIDER_UNAVAILABLE/);
  });

  it('matches a selection stored as the integration id', () => {
    const f = providerFindings(validateNotifications({ ...base, channelRows: [{ code: 'SMS', enabled: true, provider: 'i1', active: true }], integrationRows: [twilio] }));
    expect(f).toEqual([]);
  });

  it('cannot check missing/inactive without the integrations, but still asks for a selection', () => {
    const noIntegrations = providerFindings(validateNotifications({ ...base, channelRows: [{ code: 'SMS', enabled: true, provider: 'whatever', active: true }] }));
    expect(noIntegrations).toEqual([]);
    const unselected = providerFindings(validateNotifications({ ...base, channelRows: [{ code: 'SMS', enabled: true, active: true }] }));
    expect(unselected).toHaveLength(1);
  });

  it('exempts disabled channels, inactive rows, unknown codes and legacy direct gateways', () => {
    const cases = [
      { code: 'SMS', enabled: false, active: true },
      { code: 'SMS', enabled: true, active: false },
      { code: 'PIGEON', enabled: true, active: true },
      { code: 'SMS', enabled: true, gateway: 'smscountry', active: true },
    ];
    for (const row of cases) {
      expect(providerFindings(validateNotifications({ ...base, channelRows: [row], integrationRows: [twilio] }))).toEqual([]);
    }
  });

  it('is silent altogether when the channel master is not supplied', () => {
    expect(providerFindings(validateNotifications({ ...base, integrationRows: [twilio] }))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Phase 2: per-channel message-structure rules.
// ---------------------------------------------------------------------------
const BS2: BusinessServiceRecord = {
  businessService: 'PGR',
  states: [
    { state: 'A', uuid: 'u1', applicationStatus: 'PENDINGFORASSIGNMENT', actions: [{ action: 'ASSIGN', nextState: 'u2', roles: ['GRO'] }] },
    { state: 'B', uuid: 'u2', applicationStatus: 'PENDINGATLME', actions: [] },
  ],
};

/** One routing row + one template row on `channel`, so only content rules can fire. */
function pair(channel: string, template: Partial<TemplateRow> = {}) {
  const routingRows: RoutingRow[] = [
    { businessService: 'PGR', action: 'ASSIGN', toState: 'PENDINGATLME', audience: 'CITIZEN', channel, active: true },
  ];
  const templateRows: TemplateRow[] = [
    { audience: 'CITIZEN', action: 'ASSIGN', toState: 'PENDINGATLME', channel, locale: 'en_IN', body: 'ok', active: true, ...template },
  ];
  return { businessService: BS2, roleCodes: ['GRO'], routingRows, templateRows };
}

describe('scanPlaceholders', () => {
  it('reports the tokens pgr-services substitutes, in first-appearance order', () => {
    expect(placeholderTokens('Hi {citizen_name}, {id} on {date} ({id})')).toEqual(['citizen_name', 'id', 'date']);
  });

  it('accepts a well-formed single-brace body', () => {
    expect(scanPlaceholders('Complaint {id} for {complaint_type}').malformed).toEqual([]);
  });

  it('flags the double brace an operator pastes in from Handlebars', () => {
    const s = scanPlaceholders('Complaint {{id}}');
    expect(s.malformed).toContain('{{');
    // pgr-services' own regex still matches the INNER {id}, so the recipient
    // gets the value wrapped in braces. The token IS reported as substituted.
    expect(s.tokens).toEqual(['id']);
  });

  it('flags an unclosed brace, a stray closing brace and a non-token inside braces', () => {
    expect(scanPlaceholders('Complaint {id').malformed).toEqual(['{id']);
    expect(scanPlaceholders('Complaint id}').malformed).toEqual(['}']);
    expect(scanPlaceholders('Complaint { id }').malformed).toEqual(['{ id }']);
    expect(scanPlaceholders('Complaint {}').malformed).toEqual(['{}']);
  });

  it('does not flag ordinary punctuation', () => {
    expect(scanPlaceholders('Complaint {id} (urgent) — 50% done').malformed).toEqual([]);
  });
});

describe('R11 placeholder-braces', () => {
  it('errors on a malformed brace in the body and names it', () => {
    const f = validateNotifications(pair('SMS', { body: 'Complaint {{id}} filed' }));
    const r = f.find((x) => x.rule === 'placeholder-braces');
    expect(r?.level).toBe('error');
    expect(r?.message).toMatch(/\{\{/);
  });

  it('errors on a malformed brace in an EMAIL subject too', () => {
    const f = validateNotifications(pair('EMAIL', { subject: 'Complaint {id', body: 'x {id}' }));
    expect(f.some((x) => x.rule === 'placeholder-braces' && x.level === 'error')).toBe(true);
  });

  it('is silent for a clean body', () => {
    expect(validateNotifications(pair('SMS', { body: 'Complaint {id}' })).filter((x) => x.rule === 'placeholder-braces')).toHaveLength(0);
  });

  it('ignores an inactive template', () => {
    const f = validateNotifications({ ...pair('SMS'), templateRows: [{ audience: 'CITIZEN', action: 'ASSIGN', toState: 'PENDINGATLME', channel: 'SMS', locale: 'en_IN', body: '{{id}}', active: false }] });
    expect(f.filter((x) => x.rule === 'placeholder-braces')).toHaveLength(0);
  });
});

describe('R12 template-needs-body', () => {
  it('errors on an active template with an empty body, on every channel', () => {
    for (const ch of ['SMS', 'WHATSAPP', 'EMAIL']) {
      const f = validateNotifications(pair(ch, { body: '   ', subject: 'S' }));
      const r = f.find((x) => x.rule === 'template-needs-body');
      expect(r?.level, ch).toBe('error');
    }
  });

  it('is silent for a non-empty body', () => {
    expect(validateNotifications(pair('SMS')).filter((x) => x.rule === 'template-needs-body')).toHaveLength(0);
  });
});

describe('R13 sms-length', () => {
  const long = (n: number) => 'a'.repeat(n);

  it('stays silent for a body that fits in three GSM-7 segments', () => {
    // 3 * 153 = 459 septets is the last body that is still 3 segments.
    expect(validateNotifications(pair('SMS', { body: long(459) })).filter((x) => x.rule === 'sms-length')).toHaveLength(0);
  });

  it('warns once past three segments and says what it costs', () => {
    const f = validateNotifications(pair('SMS', { body: long(460) }));
    const r = f.find((x) => x.rule === 'sms-length');
    expect(r?.level).toBe('warn');
    expect(r?.message).toMatch(/4 segments/);
    expect(r?.message).toMatch(/billed separately/);
  });

  it('warns far earlier for a non-GSM-7 body and explains why', () => {
    // 220 Devanagari characters is 4 UCS-2 segments; the same count of ASCII is 2.
    expect(validateNotifications(pair('SMS', { body: long(220) })).filter((x) => x.rule === 'sms-length')).toHaveLength(0);
    const f = validateNotifications(pair('SMS', { body: 'न'.repeat(220) }));
    const r = f.find((x) => x.rule === 'sms-length');
    expect(r?.level).toBe('warn');
    expect(r?.message).toMatch(/UCS-2/);
    expect(r?.message).toMatch(/"न"/);
  });

  it('counts the placeholder allowance, so a token-heavy body trips earlier', () => {
    // 450 characters of text is 3 segments; add 3 placeholders (+12 each) and
    // the estimate crosses into a 4th.
    expect(validateNotifications(pair('SMS', { body: long(450) })).filter((x) => x.rule === 'sms-length')).toHaveLength(0);
    const withTokens = `${long(426)}{id}{date}{ulb}`;
    expect(validateNotifications(pair('SMS', { body: withTokens })).some((x) => x.rule === 'sms-length')).toBe(true);
  });

  it('never fires on WHATSAPP or EMAIL', () => {
    for (const ch of ['WHATSAPP', 'EMAIL']) {
      const f = validateNotifications(pair(ch, { body: long(2000), subject: 'S' }));
      expect(f.filter((x) => x.rule === 'sms-length'), ch).toHaveLength(0);
    }
  });
});

describe('R14 email-subject-length', () => {
  it('warns above the documented maximum and stays silent at it', () => {
    const at = validateNotifications(pair('EMAIL', { subject: 'S'.repeat(EMAIL_SUBJECT_MAX) }));
    expect(at.filter((x) => x.rule === 'email-subject-length')).toHaveLength(0);
    const over = validateNotifications(pair('EMAIL', { subject: 'S'.repeat(EMAIL_SUBJECT_MAX + 1) }));
    const r = over.find((x) => x.rule === 'email-subject-length');
    expect(r?.level).toBe('warn');
    expect(r?.message).toMatch(String(EMAIL_SUBJECT_MAX + 1));
  });

  it('does not double-report with email-needs-subject', () => {
    const f = validateNotifications(pair('EMAIL', { subject: '' }));
    expect(f.filter((x) => x.rule === 'email-needs-subject')).toHaveLength(1);
    expect(f.filter((x) => x.rule === 'email-subject-length')).toHaveLength(0);
  });
});

describe('resolveProviderTemplate (mirrors pgr-services)', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    provider: 'twilio', channel: 'WHATSAPP', audience: 'CITIZEN', action: 'ASSIGN',
    toState: 'PENDINGATLME', locale: 'en_IN', templateId: 'HX1', variables: ['id'],
    approvalStatus: 'approved', active: true, ...over,
  });
  const t = { audience: 'CITIZEN', action: 'ASSIGN', toState: 'PENDINGATLME', locale: 'hi_IN' };

  it('prefers the row locale, then falls back to the default locale', () => {
    expect(resolveProviderTemplate([row({ locale: 'hi_IN', templateId: 'HXhi' })], t, 'en_IN')?.templateId).toBe('HXhi');
    expect(resolveProviderTemplate([row()], t, 'en_IN')?.templateId).toBe('HX1');
  });

  it('refuses a row that is inactive, unapproved, another provider/channel or has no templateId', () => {
    const own = { ...t, locale: 'en_IN' };
    for (const bad of [{ active: false }, { approvalStatus: 'pending' }, { provider: 'gupshup' }, { channel: 'SMS' }, { templateId: '' }]) {
      expect(resolveProviderTemplate([row(bad)], own, 'en_IN'), JSON.stringify(bad)).toBeUndefined();
    }
  });

  it('matches case-insensitively', () => {
    expect(resolveProviderTemplate([row({ audience: 'citizen', action: 'assign', toState: 'pendingatlme', locale: 'EN_in', approvalStatus: 'APPROVED' })], { ...t, locale: 'en_IN' }, 'en_IN')).toBeTruthy();
  });
});

describe('R15/R16 WhatsApp provider-template variables', () => {
  const pt = (over: Record<string, unknown> = {}) => ({
    provider: 'twilio', channel: 'WHATSAPP', audience: 'CITIZEN', action: 'ASSIGN',
    toState: 'PENDINGATLME', locale: 'en_IN', templateId: 'HX1',
    approvalStatus: 'approved', active: true, variables: ['complaint_type', 'id', 'date'], ...over,
  });
  const base = (body: string, rows: Record<string, unknown>[]) => ({
    ...pair('WHATSAPP', { body }),
    providerTemplateRows: rows,
  });

  it('passes when every body placeholder is declared, in any order', () => {
    const f = validateNotifications(base('Your {complaint_type} complaint {id} on {date}', [pt()]));
    expect(f.filter((x) => x.rule.startsWith('whatsapp-variable'))).toEqual([]);
  });

  it('errors on a body placeholder the provider template does not declare', () => {
    const f = validateNotifications(base('Assigned to {emp_name} — complaint {id}', [pt()]));
    const r = f.find((x) => x.rule === 'whatsapp-variable-unmapped');
    expect(r?.level).toBe('error');
    expect(r?.message).toMatch(/\{emp_name\}/);
    expect(r?.message).toMatch(/HX1/);
  });

  it('errors when the provider template declares no variables at all but the body has some', () => {
    const f = validateNotifications(base('Complaint {id}', [pt({ variables: undefined })]));
    const r = f.find((x) => x.rule === 'whatsapp-variable-unmapped');
    expect(r?.level).toBe('error');
    expect(r?.message).toMatch(/declares no variables/);
  });

  it('accepts a declared variable the body does not use (the provider template may reference it)', () => {
    const f = validateNotifications(base('Complaint {id}', [pt({ variables: ['id', 'complaint_type'] })]));
    expect(f.filter((x) => x.rule === 'whatsapp-variable-unmapped')).toHaveLength(0);
  });

  it('warns about a declared variable pgr-services cannot fill', () => {
    const f = validateNotifications(base('Complaint {id}', [pt({ variables: ['id', 'ticket_no'] })]));
    const r = f.find((x) => x.rule === 'whatsapp-variable-unfilled');
    expect(r?.level).toBe('warn');
    expect(r?.message).toMatch(/ticket_no/);
    expect(r?.message).toMatch(/empty string/);
  });

  it('stays silent when there is no provider template (whatsapp-needs-template owns that case)', () => {
    const f = validateNotifications(base('Complaint {emp_name}', []));
    expect(f.filter((x) => x.rule.startsWith('whatsapp-variable'))).toEqual([]);
    expect(f.some((x) => x.rule === 'whatsapp-needs-template')).toBe(true);
  });

  it('is silent altogether when provider templates were not supplied', () => {
    const f = validateNotifications(pair('WHATSAPP', { body: 'Complaint {emp_name}' }));
    expect(f.filter((x) => x.rule.startsWith('whatsapp-variable'))).toEqual([]);
  });
});

describe('rule table', () => {
  it('has a unique id and a summary for every rule', () => {
    const ids = NOTIFICATION_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of NOTIFICATION_RULES) expect(r.summary.length, r.id).toBeGreaterThan(20);
  });
});
