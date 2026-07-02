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
});
