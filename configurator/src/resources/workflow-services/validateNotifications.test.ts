import { describe, it, expect } from 'vitest';
import {
  validateNotifications,
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
