import { describe, it, expect } from 'vitest';
import {
  validateNotifications,
  scanPlaceholders,
  placeholderTokens,
  resolveProviderTemplate,
  NOTIFICATION_RULES,
  RETIRED_RULES,
  EMAIL_SUBJECT_MAX,
  type ProviderTemplateRow,
  type RoutingRow,
  type TemplateRow,
} from './validateNotifications';
import type { EventCatalogueRow } from '../notification-configure/eventCatalogue';
import { PLACEHOLDER_VOCABULARY } from '../notification-configure/legacyAdapter';

// The vocabulary is now the event catalogue, not a workflow state machine. These
// fixtures are shaped like the rows the seed-time generator emits for PGR.
const ASSIGN = 'COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME';
const RESOLVE = 'COMPLAINTS.WORKFLOW.RESOLVE.RESOLVED';

function event(eventName: string, over: Partial<EventCatalogueRow> = {}): EventCatalogueRow {
  return {
    module: 'Complaints',
    eventName,
    entityType: 'COMPLAINT',
    label: eventName,
    actors: [{ name: 'citizen', required: true }, { name: 'assignee' }],
    placeholders: PLACEHOLDER_VOCABULARY.map((name) => ({ name })),
    active: true,
    ...over,
  };
}

const CATALOGUE: EventCatalogueRow[] = [event(ASSIGN), event(RESOLVE)];
const ROLE_CODES = ['GRO', 'PGR_LME', 'CSR'];

function template(overrides: Partial<TemplateRow> = {}): TemplateRow {
  return {
    module: 'Complaints',
    eventName: ASSIGN,
    audience: 'ACTOR:citizen',
    channel: 'SMS',
    locale: 'en_IN',
    body: 'hi',
    active: true,
    ...overrides,
  };
}

function routing(overrides: Partial<RoutingRow> = {}): RoutingRow {
  return {
    module: 'Complaints',
    eventName: ASSIGN,
    audience: 'ACTOR:citizen',
    channel: 'SMS',
    active: true,
    ...overrides,
  };
}

describe('validateNotifications', () => {
  it('returns no findings for a fully valid config', () => {
    const findings = validateNotifications({
      catalogue: CATALOGUE,
      routingRows: [routing()],
      templateRows: [template()],
      roleCodes: ROLE_CODES,
    });
    expect(findings).toEqual([]);
  });

  it('R1: flags a ROLE: term that is not a known role code', () => {
    const findings = validateNotifications({
      catalogue: CATALOGUE,
      routingRows: [routing({ audience: 'ROLE:NONEXISTENT_ROLE' })],
      templateRows: [template({ audience: 'ROLE:NONEXISTENT_ROLE' })],
      roleCodes: ROLE_CODES,
    });
    expect(findings.some((f) => f.rule === 'audience-role-exists' && f.level === 'error')).toBe(true);
  });

  it('R1: flags an ACTOR: term the event does not declare, and names what it does declare', () => {
    const findings = validateNotifications({
      catalogue: CATALOGUE,
      routingRows: [routing({ audience: 'ACTOR:inspector' })],
      templateRows: [template({ audience: 'ACTOR:inspector' })],
      roleCodes: ROLE_CODES,
    });
    const f = findings.find((x) => x.rule === 'audience-role-exists');
    expect(f?.level).toBe('error');
    expect(f?.message).toMatch(/inspector/);
    expect(f?.message).toMatch(/citizen, assignee/);
  });

  it('R1: checks EVERY term of a fallback chain, not just the first', () => {
    // `ACTOR:assignee|ROLE:TYPO` resolves for most events and silently narrows
    // for the rest — exactly the failure a chain is supposed to prevent.
    const findings = validateNotifications({
      catalogue: CATALOGUE,
      routingRows: [routing({ audience: 'ACTOR:assignee|ROLE:TYPO' })],
      templateRows: [template({ audience: 'ACTOR:assignee|ROLE:TYPO' })],
      roleCodes: ROLE_CODES,
    });
    const f = findings.filter((x) => x.rule === 'audience-role-exists');
    expect(f).toHaveLength(1);
    expect(f[0].message).toMatch(/TYPO/);
  });

  it('R1: accepts a legacy bare audience, mapped exactly as the box maps it', () => {
    // CITIZEN -> ACTOR:citizen, EMPLOYEE -> ACTOR:assignee, bare role -> ROLE:<it>.
    for (const [bare, ok] of [['CITIZEN', true], ['EMPLOYEE', true], ['GRO', true], ['NOPE', false]] as const) {
      const findings = validateNotifications({
        catalogue: CATALOGUE,
        routingRows: [routing({ audience: bare })],
        templateRows: [template({ audience: bare })],
        roleCodes: ROLE_CODES,
      });
      expect(findings.filter((f) => f.rule === 'audience-role-exists').length === 0, bare).toBe(ok);
    }
  });

  it('R1b: refuses an audience whose scheme the box has no resolver for', () => {
    const findings = validateNotifications({
      catalogue: CATALOGUE,
      routingRows: [routing({ audience: 'GROUP:ward-team' })],
      templateRows: [template({ audience: 'GROUP:ward-team' })],
      roleCodes: ROLE_CODES,
    });
    const f = findings.find((x) => x.rule === 'audience-scheme');
    expect(f?.level).toBe('error');
    expect(f?.message).toMatch(/GROUP:ward-team/);
    // It must not ALSO be reported as an unknown role: one problem, one finding.
    expect(findings.filter((x) => x.rule === 'audience-role-exists')).toHaveLength(0);
  });

  it('R1b: accepts EVENT_RECIPIENTS, which needs neither an actor nor a role', () => {
    const findings = validateNotifications({
      catalogue: CATALOGUE,
      routingRows: [routing({ audience: 'EVENT_RECIPIENTS' })],
      templateRows: [template({ audience: 'EVENT_RECIPIENTS' })],
      roleCodes: [],
    });
    expect(findings).toEqual([]);
  });

  it('R2: flags an active routing row with no matching template', () => {
    const findings = validateNotifications({
      catalogue: CATALOGUE,
      routingRows: [routing()],
      templateRows: [], // no templates at all
      roleCodes: ROLE_CODES,
    });
    expect(findings.some((f) => f.rule === 'routing-has-template' && f.level === 'error')).toBe(true);
  });

  it('R2: flags when only a non-default locale template exists', () => {
    const findings = validateNotifications({
      catalogue: CATALOGUE,
      routingRows: [routing()],
      templateRows: [template({ locale: 'sw_KE' })],
      roleCodes: ROLE_CODES,
    });
    const f = findings.find((x) => x.rule === 'routing-has-template');
    expect(f?.level).toBe('error');
    expect(f?.message).toMatch(/another locale/);
  });

  it('R2: matches a legacy bare audience against a scheme-form template', () => {
    // A tenant part-way through the copy must not be told every row is an orphan.
    const findings = validateNotifications({
      catalogue: CATALOGUE,
      routingRows: [routing({ audience: 'CITIZEN' })],
      templateRows: [template({ audience: 'ACTOR:citizen' })],
      roleCodes: ROLE_CODES,
    });
    expect(findings).toEqual([]);
  });

  it('R3: flags a disallowed channel', () => {
    const findings = validateNotifications({
      catalogue: CATALOGUE,
      routingRows: [routing({ channel: 'PIGEON' })],
      templateRows: [template({ channel: 'PIGEON' })],
      roleCodes: ROLE_CODES,
    });
    expect(findings.some((f) => f.rule === 'channel-allowed' && f.level === 'error')).toBe(true);
  });

  it('R4: flags a routing row whose event is not in the catalogue', () => {
    const findings = validateNotifications({
      catalogue: CATALOGUE,
      routingRows: [routing({ eventName: 'COMPLAINTS.WORKFLOW.GHOST.NOWHERE' })],
      templateRows: [template({ eventName: 'COMPLAINTS.WORKFLOW.GHOST.NOWHERE' })],
      roleCodes: ROLE_CODES,
    });
    const f = findings.find((x) => x.rule === 'transition-exists');
    expect(f?.level).toBe('error');
    expect(f?.message).toMatch(/event catalogue/);
  });

  it('R4: an INACTIVE catalogue row is not a valid routing target', () => {
    const findings = validateNotifications({
      catalogue: [event(ASSIGN, { active: false }), event(RESOLVE)],
      routingRows: [routing()],
      templateRows: [template()],
      roleCodes: ROLE_CODES,
    });
    expect(findings.some((f) => f.rule === 'transition-exists')).toBe(true);
  });

  it('R4b: warns when a routing row uses a channel the event does not declare', () => {
    const findings = validateNotifications({
      catalogue: [event(ASSIGN, { channels: ['EMAIL'] })],
      routingRows: [routing({ channel: 'SMS' })],
      templateRows: [template({ channel: 'SMS' })],
      roleCodes: ROLE_CODES,
    });
    const f = findings.find((x) => x.rule === 'channel-in-event');
    expect(f?.level).toBe('warn');
    expect(f?.message).toMatch(/declares channels EMAIL/);
  });

  it('R4b: an absent channel list means "no restriction", not "nothing allowed"', () => {
    const findings = validateNotifications({
      catalogue: [event(ASSIGN, { channels: [] })],
      routingRows: [routing({ channel: 'SMS' })],
      templateRows: [template({ channel: 'SMS' })],
      roleCodes: ROLE_CODES,
    });
    expect(findings.filter((f) => f.rule === 'channel-in-event')).toHaveLength(0);
  });

  it('R5: warns about an orphan template with no matching routing', () => {
    const findings = validateNotifications({
      catalogue: CATALOGUE,
      routingRows: [routing()],
      templateRows: [
        template(),
        template({ eventName: RESOLVE, channel: 'EMAIL', subject: 'S' }),
      ],
      roleCodes: ROLE_CODES,
    });
    expect(findings.some((f) => f.rule === 'no-orphan-template' && f.level === 'warn')).toBe(true);
  });

  it('R6: warns about a non-notifiable audience', () => {
    const findings = validateNotifications({
      catalogue: CATALOGUE,
      routingRows: [routing({ audience: 'AUTO_ESCALATE' })],
      templateRows: [template({ audience: 'AUTO_ESCALATE' })],
      roleCodes: ROLE_CODES,
    });
    expect(findings.some((f) => f.rule === 'non-notifiable-audience' && f.level === 'warn')).toBe(true);
    // R1 and R1b must NOT also fire for a non-notifiable pseudo-audience.
    expect(findings.filter((f) => f.rule === 'audience-role-exists')).toHaveLength(0);
    expect(findings.filter((f) => f.rule === 'audience-scheme')).toHaveLength(0);
  });

  it('compares case-insensitively', () => {
    const findings = validateNotifications({
      catalogue: CATALOGUE,
      routingRows: [routing({ audience: 'actor:CITIZEN', eventName: ASSIGN.toLowerCase(), channel: 'sms' })],
      templateRows: [template({ audience: 'ACTOR:citizen', channel: 'sms' })],
      roleCodes: ROLE_CODES,
    });
    expect(findings).toEqual([]);
  });

  it('ignores inactive routing rows for template presence', () => {
    const findings = validateNotifications({
      catalogue: CATALOGUE,
      routingRows: [routing({ active: false })],
      templateRows: [],
      roleCodes: ROLE_CODES,
    });
    expect(findings.filter((f) => f.rule === 'routing-has-template')).toHaveLength(0);
  });

  it('a full clean multi-row config passes', () => {
    const routingRows = [
      routing({ audience: 'ACTOR:citizen', channel: 'SMS' }),
      routing({ audience: 'ROLE:GRO', channel: 'EMAIL' }),
      routing({ eventName: RESOLVE, audience: 'ACTOR:citizen', channel: 'SMS' }),
    ];
    const templateRows = [
      template({ audience: 'ACTOR:citizen', channel: 'SMS' }),
      template({ audience: 'ROLE:GRO', channel: 'EMAIL', subject: 'Complaint {id} assigned' }),
      template({ eventName: RESOLVE, audience: 'ACTOR:citizen', channel: 'SMS' }),
    ];
    expect(validateNotifications({ catalogue: CATALOGUE, routingRows, templateRows, roleCodes: ROLE_CODES })).toEqual([]);
  });

  it('attaches a ref of AUDIENCE · EVENT · CHANNEL, with the audience canonicalised', () => {
    const findings = validateNotifications({
      catalogue: CATALOGUE,
      routingRows: [routing({ audience: 'CITIZEN' })],
      templateRows: [],
      roleCodes: ROLE_CODES,
    });
    expect(findings[0].ref).toBe(`ACTOR:CITIZEN · ${ASSIGN} · SMS`);
  });
});

describe('R7 channel-enabled', () => {
  const routingRows = [routing()];
  const templateRows = [template()];
  const base = { catalogue: CATALOGUE, routingRows, templateRows, roleCodes: ROLE_CODES };

  it('is silent when no channel rows are supplied (master not seeded)', () => {
    expect(validateNotifications(base).filter((x) => x.rule === 'channel-enabled')).toHaveLength(0);
  });

  it('warns once per channel that is disabled or has no policy row', () => {
    const disabled = validateNotifications({ ...base, channelRows: [{ code: 'SMS', enabled: false, active: true }] });
    expect(disabled.filter((x) => x.rule === 'channel-enabled').map((x) => x.level)).toEqual(['warn']);
    expect(disabled.find((x) => x.rule === 'channel-enabled')?.message).toMatch(/disabled/);

    const missing = validateNotifications({
      ...base,
      routingRows: [routing(), routing({ audience: 'ROLE:GRO' })],
      channelRows: [{ code: 'EMAIL', enabled: true, active: true }],
    });
    expect(missing.filter((x) => x.rule === 'channel-enabled')).toHaveLength(1);
    expect(missing.find((x) => x.rule === 'channel-enabled')?.message).toMatch(/no channel-policy row/);
  });

  it('does not warn for an enabled channel', () => {
    const f = validateNotifications({ ...base, channelRows: [{ code: 'SMS', enabled: true, active: true }] });
    expect(f.filter((x) => x.rule === 'channel-enabled')).toHaveLength(0);
  });
});

describe('R7a channel-gateway-mismatch', () => {
  const base = { catalogue: CATALOGUE, routingRows: [routing()], templateRows: [template()], roleCodes: ROLE_CODES };
  const rule = (f: ReturnType<typeof validateNotifications>) => f.filter((x) => x.rule === 'channel-gateway-mismatch');

  it('rejects the SMS-only smscountry gateway on EMAIL and on WHATSAPP', () => {
    for (const code of ['EMAIL', 'WHATSAPP']) {
      const f = rule(validateNotifications({
        ...base,
        channelRows: [{ code, enabled: true, gateway: 'smscountry', active: true }],
      }));
      expect(f, code).toHaveLength(1);
      expect(f[0].level).toBe('error');
      expect(f[0].ref).toBe(code);
      expect(f[0].message).toMatch(/carries SMS only/);
    }
  });

  it('accepts smscountry on SMS, and novu anywhere', () => {
    expect(rule(validateNotifications({
      ...base,
      channelRows: [
        { code: 'SMS', enabled: true, gateway: 'smscountry', active: true },
        { code: 'EMAIL', enabled: true, gateway: 'novu', active: true },
        { code: 'WHATSAPP', enabled: true, active: true },
      ],
    }))).toHaveLength(0);
  });

  it('fires on a row that is switched off, because the row is wrong as written', () => {
    // The save guard has to refuse this the moment it is typed — an operator who
    // also unticks `enabled` has not fixed the gateway, only hidden it.
    const f = rule(validateNotifications({
      ...base,
      channelRows: [{ code: 'EMAIL', enabled: false, gateway: 'SMSCountry', active: true }],
    }));
    expect(f).toHaveLength(1);
  });

  it('ignores a soft-deleted row', () => {
    expect(rule(validateNotifications({
      ...base,
      channelRows: [{ code: 'EMAIL', enabled: true, gateway: 'smscountry', active: false }],
    }))).toHaveLength(0);
  });
});

describe('template content + WhatsApp provider template', () => {
  const base = { catalogue: CATALOGUE, roleCodes: ROLE_CODES };

  it('flags tokens the event does not declare', () => {
    const f = validateNotifications({
      ...base,
      routingRows: [routing()],
      templateRows: [template({ body: 'Hi {citizen_name}, ref {ticket_no} on {date}' })],
    });
    const u = f.find((x) => x.rule === 'unknown-token');
    expect(u?.message).toMatch(/\{ticket_no\}/);
    expect(u?.message).not.toMatch(/citizen_name\}/);
  });

  it('takes the vocabulary from the EVENT, so two events can differ', () => {
    const licence = event('XYZ.LICENCE.RENEWED', {
      module: 'XYZ',
      placeholders: [{ name: 'licence_no' }, { name: 'valid_until' }],
    });
    const f = validateNotifications({
      catalogue: [...CATALOGUE, licence],
      roleCodes: ROLE_CODES,
      routingRows: [routing({ module: 'XYZ', eventName: 'XYZ.LICENCE.RENEWED', audience: 'EVENT_RECIPIENTS' })],
      templateRows: [template({ module: 'XYZ', eventName: 'XYZ.LICENCE.RENEWED', audience: 'EVENT_RECIPIENTS', body: 'Licence {licence_no} valid to {valid_until}' })],
    });
    expect(f.filter((x) => x.rule === 'unknown-token')).toHaveLength(0);

    const wrongVocab = validateNotifications({
      catalogue: [...CATALOGUE, licence],
      roleCodes: ROLE_CODES,
      routingRows: [routing({ module: 'XYZ', eventName: 'XYZ.LICENCE.RENEWED', audience: 'EVENT_RECIPIENTS' })],
      // `{id}` is fine for a complaint and meaningless for this licence event.
      templateRows: [template({ module: 'XYZ', eventName: 'XYZ.LICENCE.RENEWED', audience: 'EVENT_RECIPIENTS', body: 'Licence {id}' })],
    });
    expect(wrongVocab.find((x) => x.rule === 'unknown-token')?.message).toMatch(/\{id\}/);
  });

  it('says nothing about tokens when the event itself is uncatalogued', () => {
    // transition-exists already reports the cause; flagging every token would bury it.
    const f = validateNotifications({
      ...base,
      routingRows: [routing({ eventName: 'NOPE.EVENT' })],
      templateRows: [template({ eventName: 'NOPE.EVENT', body: 'Hi {whatever}' })],
    });
    expect(f.filter((x) => x.rule === 'unknown-token')).toHaveLength(0);
    expect(f.some((x) => x.rule === 'transition-exists')).toBe(true);
  });

  it('warns on an EMAIL template without a subject', () => {
    const f = validateNotifications({
      ...base,
      routingRows: [routing({ channel: 'EMAIL' })],
      templateRows: [template({ channel: 'EMAIL', subject: '' })],
    });
    expect(f.some((x) => x.rule === 'email-needs-subject')).toBe(true);
  });

  it('warns on a WHATSAPP routing row with no approved provider template, silent when one exists or rows are not supplied', () => {
    const routingRows = [routing({ channel: 'WHATSAPP' })];
    const templateRows = [template({ channel: 'WHATSAPP', body: 'x' })];
    const approved: ProviderTemplateRow = {
      provider: 'twilio', channel: 'WHATSAPP', audience: 'ACTOR:citizen', eventName: ASSIGN,
      locale: 'en_IN', templateId: 'HX1', approvalStatus: 'approved', active: true,
    };
    expect(validateNotifications({ ...base, routingRows, templateRows }).some((x) => x.rule === 'whatsapp-needs-template')).toBe(false);
    expect(validateNotifications({ ...base, routingRows, templateRows, providerTemplateRows: [] }).some((x) => x.rule === 'whatsapp-needs-template')).toBe(true);
    expect(validateNotifications({ ...base, routingRows, templateRows, providerTemplateRows: [approved] }).some((x) => x.rule === 'whatsapp-needs-template')).toBe(false);
  });
});

describe('R7b channel provider selection', () => {
  const base = { catalogue: CATALOGUE, roleCodes: ROLE_CODES, routingRows: [routing()], templateRows: [template()] };
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
// Per-channel message-structure rules.
// ---------------------------------------------------------------------------

/** One routing row + one template row on `channel`, so only content rules can fire. */
function pair(channel: string, over: Partial<TemplateRow> = {}) {
  return {
    catalogue: CATALOGUE,
    roleCodes: ROLE_CODES,
    routingRows: [routing({ channel })],
    templateRows: [template({ channel, body: 'ok', ...over })],
  };
}

describe('scanPlaceholders', () => {
  it('reports the tokens the renderer substitutes, in first-appearance order', () => {
    expect(placeholderTokens('Hi {citizen_name}, {id} on {date} ({id})')).toEqual(['citizen_name', 'id', 'date']);
  });

  it('accepts a well-formed single-brace body', () => {
    expect(scanPlaceholders('Complaint {id} for {complaint_type}').malformed).toEqual([]);
  });

  it('flags the double brace an operator pastes in from Handlebars', () => {
    const s = scanPlaceholders('Complaint {{id}}');
    expect(s.malformed).toContain('{{');
    // The renderer's own regex still matches the INNER {id}, so the recipient
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

describe('placeholder-braces', () => {
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
    const f = validateNotifications({ ...pair('SMS'), templateRows: [template({ body: '{{id}}', active: false })] });
    expect(f.filter((x) => x.rule === 'placeholder-braces')).toHaveLength(0);
  });
});

describe('template-needs-body', () => {
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

describe('sms-length', () => {
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

describe('email-subject-length', () => {
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

describe('resolveProviderTemplate (mirrors the runtime resolution order)', () => {
  const row = (over: Record<string, unknown> = {}): ProviderTemplateRow => ({
    provider: 'twilio', channel: 'WHATSAPP', audience: 'ACTOR:citizen', eventName: ASSIGN,
    locale: 'en_IN', templateId: 'HX1', variables: ['id'],
    approvalStatus: 'approved', active: true, ...over,
  });
  const t = { audience: 'ACTOR:citizen', eventName: ASSIGN, locale: 'hi_IN' };

  it('prefers the row locale, then falls back to the default locale', () => {
    expect(resolveProviderTemplate([row({ locale: 'hi_IN', templateId: 'HXhi' })], t, 'en_IN')?.templateId).toBe('HXhi');
    expect(resolveProviderTemplate([row()], t, 'en_IN')?.templateId).toBe('HX1');
  });

  it('refuses a row that is inactive, unapproved, another provider/channel/event or has no templateId', () => {
    const own = { ...t, locale: 'en_IN' };
    for (const bad of [{ active: false }, { approvalStatus: 'pending' }, { provider: 'gupshup' }, { channel: 'SMS' }, { templateId: '' }, { eventName: RESOLVE }]) {
      expect(resolveProviderTemplate([row(bad)], own, 'en_IN'), JSON.stringify(bad)).toBeUndefined();
    }
  });

  it('matches case-insensitively, and matches a legacy bare audience to a scheme one', () => {
    expect(resolveProviderTemplate([row({ audience: 'CITIZEN', eventName: ASSIGN.toLowerCase(), locale: 'EN_in', approvalStatus: 'APPROVED' })], { ...t, locale: 'en_IN' }, 'en_IN')).toBeTruthy();
  });
});

describe('WhatsApp provider-template variables', () => {
  const pt = (over: Record<string, unknown> = {}): ProviderTemplateRow => ({
    provider: 'twilio', channel: 'WHATSAPP', audience: 'ACTOR:citizen', eventName: ASSIGN,
    locale: 'en_IN', templateId: 'HX1',
    approvalStatus: 'approved', active: true, variables: ['complaint_type', 'id', 'date'], ...over,
  });
  const base = (body: string, rows: ProviderTemplateRow[]) => ({
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

  it('warns about a declared variable the EVENT cannot fill', () => {
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

  it('gives every retired rule a reason, and never emits one', () => {
    // A rule that stops making sense is marked retired here, never deleted — an
    // operator reading a finding id in an old ticket must be able to find out
    // what happened to it.
    for (const r of NOTIFICATION_RULES) {
      if (r.status === 'retired') expect((r.retiredReason ?? '').length, r.id).toBeGreaterThan(20);
    }
    const emitted = validateNotifications({
      catalogue: CATALOGUE,
      routingRows: [routing({ audience: 'GROUP:x', channel: 'PIGEON', eventName: 'NOPE' })],
      templateRows: [template({ body: '{{id}' })],
      roleCodes: ROLE_CODES,
      channelRows: [{ code: 'SMS', enabled: false, active: true }],
      providerTemplateRows: [],
      integrationRows: [],
    }).map((f) => f.rule);
    for (const rule of emitted) expect(RETIRED_RULES.has(rule), rule).toBe(false);
  });
});
