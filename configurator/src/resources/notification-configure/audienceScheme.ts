// Audience references: the "who to tell" half of a routing row, parsed.
//
// Pure and React-free (no ra-core, no MDMS) so the validator, the save guard,
// the Configure screen's picker and the seed tests all read ONE implementation.
//
// THE THREE SCHEMES (thin-event design §2.3)
//   ACTOR:<name>        resolved from the event's `actors` map — no I/O.
//   ROLE:<code>         every holder of that role in the tenant.
//   EVENT_RECIPIENTS    the event's explicit `recipients[]` (account-less flows).
//   A|B                 an ordered fallback CHAIN: the first form that yields a
//                       non-empty recipient list wins.
//
// LEGACY BARE NAMES KEEP WORKING. The ~41 routing rows on a live tenant carry
// bare audience values, and the box maps them on the way in. We mirror that map
// EXACTLY here, so the configurator shows an un-migrated tenant the same
// audiences the runtime will resolve:
//
//   CITIZEN                        -> ACTOR:citizen
//   EMPLOYEE                       -> ACTOR:assignee
//   AUTO_ESCALATE / SYSTEM         -> dropped with a warning (never notifiable)
//   anything else, assigneeOnly=0  -> ROLE:<it>
//   anything else, assigneeOnly=1  -> ACTOR:assignee|ROLE:<it>
//
// An audience whose scheme has no resolver is NOT guessed: the runtime records
// SKIPPED / NB_UNKNOWN_AUDIENCE_SCHEME, and the `audience-scheme` rule refuses
// the save that would create it.

/** The schemes the box can resolve. `UNKNOWN` is everything else. */
export type AudienceSchemeName = 'ACTOR' | 'ROLE' | 'EVENT_RECIPIENTS' | 'UNKNOWN';

/** The actor a bare `CITIZEN` audience means. */
export const LEGACY_CITIZEN_ACTOR = 'citizen';
/** The actor a bare `EMPLOYEE` audience means (the complaint's current assignee). */
export const LEGACY_ASSIGNEE_ACTOR = 'assignee';

/** Workflow pseudo-actors that are not people; a routing row on them never sends. */
export const NON_NOTIFIABLE_AUDIENCES = ['AUTO_ESCALATE', 'SYSTEM'];

/** The scheme separator inside one term, and the chain separator between terms. */
const SCHEME_SEP = ':';
const CHAIN_SEP = '|';

export interface AudienceTerm {
  /** The term as written, after the legacy mapping (e.g. `ACTOR:citizen`). */
  raw: string;
  scheme: AudienceSchemeName;
  /** Actor name for ACTOR, role code for ROLE, '' for EVENT_RECIPIENTS. */
  value: string;
  /** Comparison key: the term, uppercased. */
  key: string;
}

export interface AudienceRef {
  /** Exactly what the row stores, untouched. Writes must use this, not `key`. */
  raw: string;
  /** The chain, in fallback order. Empty for a blank or non-notifiable audience. */
  terms: AudienceTerm[];
  /** Case-insensitive comparison key for the whole chain (`ACTOR:CITIZEN`). */
  key: string;
  /** True when the raw value was a bare legacy name we mapped. */
  legacy: boolean;
  /** True for AUTO_ESCALATE / SYSTEM — flagged by `non-notifiable-audience`. */
  nonNotifiable: boolean;
  /** True when the audience is blank. */
  empty: boolean;
  /** True when every term names a scheme with a resolver AND carries a value. */
  wellFormed: boolean;
  /** The terms that are not well formed, for the `audience-scheme` finding. */
  malformed: string[];
}

const norm = (v: unknown) => String(v ?? '').trim().toUpperCase();

function term(raw: string): AudienceTerm {
  const trimmed = raw.trim();
  const upper = trimmed.toUpperCase();
  if (upper === 'EVENT_RECIPIENTS') {
    return { raw: trimmed, scheme: 'EVENT_RECIPIENTS', value: '', key: 'EVENT_RECIPIENTS' };
  }
  const at = trimmed.indexOf(SCHEME_SEP);
  if (at > 0) {
    const scheme = trimmed.slice(0, at).trim().toUpperCase();
    const value = trimmed.slice(at + 1).trim();
    if (scheme === 'ACTOR' || scheme === 'ROLE') {
      return { raw: trimmed, scheme, value, key: `${scheme}${SCHEME_SEP}${value.toUpperCase()}` };
    }
  }
  return { raw: trimmed, scheme: 'UNKNOWN', value: trimmed, key: upper };
}

/**
 * Parse an audience value into its chain of terms.
 *
 * `assigneeOnly` only matters for a BARE legacy role name: it is the flag the
 * old `NotificationRouting` master carried to mean "notify the assignee if there
 * is one, otherwise fall through to the role pool" — which is the chain
 * `ACTOR:assignee|ROLE:<code>`. It is ignored for a value that already names a
 * scheme, because such a value states its own fallback order.
 */
export function parseAudience(
  raw: unknown,
  opts: { assigneeOnly?: boolean } = {},
): AudienceRef {
  const text = String(raw ?? '').trim();
  const base: Omit<AudienceRef, 'terms' | 'key' | 'wellFormed' | 'malformed'> = {
    raw: text,
    legacy: false,
    nonNotifiable: false,
    empty: text === '',
  };

  if (!text) {
    return { ...base, terms: [], key: '', wellFormed: false, malformed: [] };
  }

  const upper = text.toUpperCase();
  if (NON_NOTIFIABLE_AUDIENCES.includes(upper)) {
    // Not a scheme and not a person. Reported by `non-notifiable-audience`, and
    // deliberately NOT reported as an unknown role or a malformed scheme too.
    return { ...base, legacy: true, nonNotifiable: true, terms: [], key: upper, wellFormed: true, malformed: [] };
  }

  let source = text;
  let legacy = false;
  if (!text.includes(SCHEME_SEP) && !text.includes(CHAIN_SEP) && upper !== 'EVENT_RECIPIENTS') {
    legacy = true;
    if (upper === 'CITIZEN') source = `ACTOR${SCHEME_SEP}${LEGACY_CITIZEN_ACTOR}`;
    else if (upper === 'EMPLOYEE') source = `ACTOR${SCHEME_SEP}${LEGACY_ASSIGNEE_ACTOR}`;
    else if (opts.assigneeOnly) source = `ACTOR${SCHEME_SEP}${LEGACY_ASSIGNEE_ACTOR}${CHAIN_SEP}ROLE${SCHEME_SEP}${text}`;
    else source = `ROLE${SCHEME_SEP}${text}`;
  }

  const terms = source
    .split(CHAIN_SEP)
    .map((t) => t.trim())
    .filter((t) => t !== '')
    .map(term);
  const malformed = terms.filter((t) => t.scheme === 'UNKNOWN' || (t.scheme !== 'EVENT_RECIPIENTS' && !t.value)).map((t) => t.raw);
  return {
    ...base,
    legacy,
    terms,
    key: terms.map((t) => t.key).join(CHAIN_SEP),
    wellFormed: terms.length > 0 && malformed.length === 0,
    malformed,
  };
}

/**
 * Case-insensitive comparison key for an audience value.
 *
 * Every cross-master match (routing <-> template <-> provider template) goes
 * through this, so a tenant part-way through the copy — legacy `CITIZEN` on one
 * master, `ACTOR:citizen` on another — still lines up instead of silently
 * reporting an orphan on both sides.
 */
export function audienceKey(raw: unknown, opts: { assigneeOnly?: boolean } = {}): string {
  const ref = parseAudience(raw, opts);
  return ref.key || norm(raw);
}

/** Build a chain value from terms, in fallback order (what the UI writes). */
export function formatAudience(terms: Array<Pick<AudienceTerm, 'scheme' | 'value'>>): string {
  return terms
    .map((t) => (t.scheme === 'EVENT_RECIPIENTS' ? 'EVENT_RECIPIENTS' : `${t.scheme}${SCHEME_SEP}${t.value}`))
    .filter((t) => t !== '')
    .join(CHAIN_SEP);
}

/** Human-readable chain for a chip or a finding: `assignee (actor) → GRO (role)`. */
export function describeAudience(ref: AudienceRef): string {
  if (ref.nonNotifiable) return `${ref.raw} (not notifiable)`;
  if (ref.empty) return '(no audience)';
  return ref.terms
    .map((t) => {
      if (t.scheme === 'ACTOR') return `${t.value} (actor)`;
      if (t.scheme === 'ROLE') return `${t.value} (role)`;
      if (t.scheme === 'EVENT_RECIPIENTS') return 'event recipients';
      return `${t.raw} (unknown scheme)`;
    })
    .join(' → ');
}
