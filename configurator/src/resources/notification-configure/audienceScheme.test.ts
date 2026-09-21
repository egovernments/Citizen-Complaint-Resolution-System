import { describe, it, expect } from 'vitest';
import {
  audienceKey,
  describeAudience,
  formatAudience,
  parseAudience,
} from './audienceScheme';

describe('parseAudience — the three schemes', () => {
  it('reads ACTOR:<name>', () => {
    const r = parseAudience('ACTOR:assignee');
    expect(r.terms).toEqual([{ raw: 'ACTOR:assignee', scheme: 'ACTOR', value: 'assignee', key: 'ACTOR:ASSIGNEE' }]);
    expect(r.wellFormed).toBe(true);
    expect(r.legacy).toBe(false);
  });

  it('reads ROLE:<code>', () => {
    const r = parseAudience('ROLE:PGR_LME');
    expect(r.terms.map((t) => [t.scheme, t.value])).toEqual([['ROLE', 'PGR_LME']]);
  });

  it('reads EVENT_RECIPIENTS, which carries no value', () => {
    const r = parseAudience('EVENT_RECIPIENTS');
    expect(r.terms.map((t) => t.scheme)).toEqual(['EVENT_RECIPIENTS']);
    expect(r.wellFormed).toBe(true);
  });

  it('reads a pipe chain in fallback order', () => {
    const r = parseAudience('ACTOR:assignee|ROLE:PGR_LME|EVENT_RECIPIENTS');
    expect(r.terms.map((t) => t.key)).toEqual(['ACTOR:ASSIGNEE', 'ROLE:PGR_LME', 'EVENT_RECIPIENTS']);
    expect(r.key).toBe('ACTOR:ASSIGNEE|ROLE:PGR_LME|EVENT_RECIPIENTS');
  });

  it('is case-insensitive on the scheme and on the comparison key, but keeps raw intact', () => {
    const r = parseAudience(' actor:Citizen ');
    expect(r.raw).toBe('actor:Citizen');
    expect(r.terms[0].scheme).toBe('ACTOR');
    expect(r.terms[0].value).toBe('Citizen');
    expect(r.key).toBe('ACTOR:CITIZEN');
  });
});

describe('parseAudience — legacy bare names', () => {
  it('maps CITIZEN to the citizen actor and EMPLOYEE to the assignee actor', () => {
    expect(parseAudience('CITIZEN').key).toBe('ACTOR:CITIZEN');
    expect(parseAudience('EMPLOYEE').key).toBe('ACTOR:ASSIGNEE');
    expect(parseAudience('CITIZEN').legacy).toBe(true);
  });

  it('maps any other bare name to a role pool', () => {
    expect(parseAudience('GRO').key).toBe('ROLE:GRO');
  });

  it('maps a bare name with assigneeOnly to the assignee-then-role chain', () => {
    // This is today's "fall through to the role pool rather than notifying
    // nobody", which the chain form replaces.
    expect(parseAudience('PGR_LME', { assigneeOnly: true }).key).toBe('ACTOR:ASSIGNEE|ROLE:PGR_LME');
  });

  it('ignores assigneeOnly for a value that already states its own chain', () => {
    expect(parseAudience('ROLE:GRO', { assigneeOnly: true }).key).toBe('ROLE:GRO');
  });

  it('flags AUTO_ESCALATE / SYSTEM as non-notifiable rather than as a role', () => {
    for (const bare of ['AUTO_ESCALATE', 'SYSTEM', 'system']) {
      const r = parseAudience(bare);
      expect(r.nonNotifiable, bare).toBe(true);
      expect(r.terms, bare).toEqual([]);
      // Not malformed: it is a recognised, deliberately non-notifiable value.
      expect(r.wellFormed, bare).toBe(true);
    }
  });
});

describe('parseAudience — refusing to guess', () => {
  it('marks an unknown scheme malformed instead of guessing a resolver', () => {
    const r = parseAudience('GROUP:ward-team');
    expect(r.wellFormed).toBe(false);
    expect(r.malformed).toEqual(['GROUP:ward-team']);
    expect(r.terms[0].scheme).toBe('UNKNOWN');
  });

  it('marks a scheme with no value malformed', () => {
    expect(parseAudience('ACTOR:').wellFormed).toBe(false);
    expect(parseAudience('ROLE:   ').wellFormed).toBe(false);
  });

  it('reports an empty audience as empty, not as malformed nonsense', () => {
    const r = parseAudience('   ');
    expect(r.empty).toBe(true);
    expect(r.terms).toEqual([]);
    expect(r.malformed).toEqual([]);
  });

  it('flags only the bad term of an otherwise valid chain', () => {
    const r = parseAudience('ACTOR:assignee|GROUP:x');
    expect(r.malformed).toEqual(['GROUP:x']);
    expect(r.terms).toHaveLength(2);
  });
});

describe('audienceKey', () => {
  it('makes a legacy bare name and its scheme form compare equal', () => {
    // This is what lets a tenant part-way through the copy line up across
    // masters instead of reporting every row as an orphan on both sides.
    expect(audienceKey('CITIZEN')).toBe(audienceKey('ACTOR:citizen'));
    expect(audienceKey('EMPLOYEE')).toBe(audienceKey('ACTOR:assignee'));
    expect(audienceKey('GRO')).toBe(audienceKey('role:gro'));
  });

  it('keeps genuinely different audiences apart', () => {
    expect(audienceKey('ACTOR:citizen')).not.toBe(audienceKey('ACTOR:assignee'));
    expect(audienceKey('ROLE:GRO')).not.toBe(audienceKey('ACTOR:GRO'));
    expect(audienceKey('ACTOR:assignee|ROLE:GRO')).not.toBe(audienceKey('ACTOR:assignee'));
  });

  it('falls back to the raw uppercased value for something unparseable', () => {
    expect(audienceKey('AUTO_ESCALATE')).toBe('AUTO_ESCALATE');
    expect(audienceKey('')).toBe('');
  });
});

describe('formatAudience / describeAudience', () => {
  it('round-trips through parse', () => {
    const value = 'ACTOR:assignee|ROLE:PGR_LME';
    expect(formatAudience(parseAudience(value).terms)).toBe(value);
  });

  it('writes EVENT_RECIPIENTS without a colon', () => {
    expect(formatAudience([{ scheme: 'EVENT_RECIPIENTS', value: '' }])).toBe('EVENT_RECIPIENTS');
  });

  it('describes a chain in plain words', () => {
    expect(describeAudience(parseAudience('ACTOR:assignee|ROLE:GRO')))
      .toBe('assignee (actor) → GRO (role)');
    expect(describeAudience(parseAudience('AUTO_ESCALATE'))).toMatch(/not notifiable/);
    expect(describeAudience(parseAudience(''))).toBe('(no audience)');
  });
});
