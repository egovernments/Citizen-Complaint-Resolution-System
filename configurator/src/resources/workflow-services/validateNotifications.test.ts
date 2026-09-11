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
      template({ action: 'ASSIGN', toState: 'PENDINGATLME', audience: 'GRO', channel: 'EMAIL' }),
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
