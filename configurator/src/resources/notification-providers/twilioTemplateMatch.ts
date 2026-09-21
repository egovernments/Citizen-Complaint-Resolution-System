// Pure matcher: Twilio Content templates (name tokens + language + approval) →
// proposed NOTIFICATIONS.ProviderTemplate rows, using THIS tenant's own routing
// and template rows as the source of truth for audiences, events and variables.
// (Previously a hand-copied action→toState→variables table inside novu-bridge.)
//
// The key moved from (audience, action, toState) to (audience, eventName), so
// the name tokens are now matched against the SEGMENTS of an event name:
// `complaints_rate_closedafterrejection_message` matches the routed event
// `COMPLAINTS.WORKFLOW.RATE.CLOSEDAFTERREJECTION` because both `rate` and
// `closedafterrejection` are segments of it. That is the same matching the
// friendly-name convention always relied on, stated in terms of the new key —
// and it is module-neutral: a module whose events are named differently matches
// on its own segments with no change here.

import { audienceKey, parseAudience } from '../notification-configure/audienceScheme';

export interface TwilioTemplateMeta {
  templateId: string;
  templateName?: string;
  language?: string;
  approvalStatus?: string;
  tokens?: string[];
}

export interface RoutingLike { audience?: string; eventName?: string; channel?: string; active?: boolean | string }
export interface TemplateLike { audience?: string; eventName?: string; channel?: string; locale?: string; body?: string; placeholders?: string[]; active?: boolean | string }

export interface MatchedTemplate {
  provider: string;
  channel: string;
  audience: string;
  eventName: string;
  locale: string;
  templateId: string;
  templateName?: string;
  variables: string[];
  approvalStatus?: string;
  active?: boolean;
}

export interface UnmatchedTemplate {
  templateId: string;
  templateName?: string;
  approvalStatus?: string;
  skipReason?: string;
}

const norm = (v: unknown) => String(v ?? '').trim().toUpperCase();
const isActive = (v: boolean | string | undefined) => v === undefined || v === null || (typeof v === 'boolean' ? v : !['FALSE', '0', 'NO'].includes(norm(v)));

/** Tokens in a template body, in order of first appearance: "{id} … {date}" → ["id","date"]. */
export function bodyTokens(body: string | undefined): string[] {
  const out: string[] = [];
  for (const m of String(body ?? '').matchAll(/\{([a-zA-Z0-9_]+)\}/g)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

function localeOf(tokens: string[], language: string | undefined): string {
  if (tokens.includes('hindi') || tokens.includes('hi')) return 'hi_IN';
  if (tokens.includes('english') || tokens.includes('en')) return 'en_IN';
  const l = String(language ?? '').toLowerCase();
  if (l.startsWith('hi')) return 'hi_IN';
  if (l.startsWith('sw')) return 'sw_KE';
  return 'en_IN';
}

/**
 * The friendly-name tokens that identify an audience: the actor names and role
 * codes in its chain, plus the legacy words operators actually used in Twilio
 * template names (`citizen`, `employee`) for the two actors those words meant.
 */
function audienceTokens(audience: string | undefined): string[] {
  const ref = parseAudience(audience);
  const out = new Set<string>();
  for (const t of ref.terms) {
    if (t.value) out.add(t.value.toUpperCase());
    if (t.scheme === 'ACTOR' && t.value.toUpperCase() === 'ASSIGNEE') out.add('EMPLOYEE');
  }
  if (ref.terms.length === 0 && audience) out.add(norm(audience));
  return [...out];
}

/**
 * Tokens that identify the template FAMILY or its variant rather than the event,
 * and so can never discriminate between two events.
 *
 * `complaints` is the load-bearing one: the convention requires it in every
 * friendly name, and it is also the first segment of every COMPLAINTS.* event
 * name — so without this exclusion every template would "match" every event on
 * that segment alone, and `complaints_resolve_message` would be silently filed
 * under whatever event happened to come first instead of being reported as
 * unrouted.
 */
const CONVENTION_TOKENS = new Set(['COMPLAINTS', 'MESSAGE', 'NEW', 'EN', 'ENGLISH', 'HI', 'HINDI', 'SW', 'SWAHILI']);

/** Event-name segments a friendly-name token can match: COMPLAINTS.WORKFLOW.RATE.X -> [COMPLAINTS, WORKFLOW, RATE, X]. */
function eventSegments(eventName: string | undefined): string[] {
  return norm(eventName).split('.').filter(Boolean);
}

export function matchTwilioTemplates(
  templates: TwilioTemplateMeta[],
  routingRows: RoutingLike[],
  templateRows: TemplateLike[],
): { matched: MatchedTemplate[]; unmatched: UnmatchedTemplate[] } {
  const waRouting = routingRows.filter((r) => norm(r.channel) === 'WHATSAPP' && isActive(r.active));
  const matched: MatchedTemplate[] = [];
  const unmatched: UnmatchedTemplate[] = [];
  const seen = new Map<string, boolean>(); // dedupe key → isNew

  for (const t of templates) {
    const tokens = (t.tokens ?? []).map((x) => x.toLowerCase());
    const upper = tokens.map((x) => x.toUpperCase());
    /** The tokens that can actually name an event or an audience. */
    const naming = upper.filter((x) => !CONVENTION_TOKENS.has(x));
    const diag = (reason: string) => unmatched.push({ templateId: t.templateId, templateName: t.templateName, approvalStatus: t.approvalStatus, skipReason: reason });
    if (!tokens.includes('complaints') || !tokens.includes('message')) { diag('friendly_name does not match complaints_…_message[_new] convention'); continue; }

    // Audience: the first routed WhatsApp audience this name names (role codes
    // and actor names both); else the citizen-ish one; else the first routed.
    const named = waRouting.find((r) => audienceTokens(r.audience).some((a) => naming.includes(a)));
    const fallback = waRouting.find((r) => audienceKey(r.audience) === 'ACTOR:CITIZEN') ?? waRouting[0];
    const audience = String((named ?? fallback)?.audience ?? '');
    if (!audience) { diag('this tenant has no active WHATSAPP routing rows to match against'); continue; }
    const wanted = audienceKey(audience);

    // Event: a routed event one of whose segments this name names.
    const sameAudience = waRouting.filter((r) => audienceKey(r.audience) === wanted);
    const candidates = sameAudience.filter((r) => eventSegments(r.eventName).some((seg) => naming.includes(seg)));
    if (candidates.length === 0) { diag('no WHATSAPP routing row for any event named in this template'); continue; }
    if (String(t.approvalStatus ?? '').toLowerCase() !== 'approved') { diag("WhatsApp approval status is not 'approved'"); continue; }

    // More than one event can share a segment (RATE → CLOSEDAFTERRESOLUTION and
    // → CLOSEDAFTERREJECTION). Prefer the one whose segments the name matches
    // most specifically; ties keep the first routed row, as before.
    const score = (r: RoutingLike) => eventSegments(r.eventName).filter((seg) => naming.includes(seg)).length;
    const best = candidates.reduce((a, b) => (score(b) > score(a) ? b : a));
    const eventName = String(best.eventName ?? '');

    const locale = localeOf(tokens, t.language);
    const tpl = templateRows.find((x) => audienceKey(x.audience) === wanted && norm(x.eventName) === norm(eventName) && norm(x.channel) === 'WHATSAPP' && norm(x.locale) === norm(locale) && isActive(x.active))
      ?? templateRows.find((x) => audienceKey(x.audience) === wanted && norm(x.eventName) === norm(eventName) && norm(x.channel) === 'WHATSAPP' && isActive(x.active));
    const variables = tpl?.placeholders && tpl.placeholders.length > 0 ? tpl.placeholders : bodyTokens(tpl?.body);
    const isNew = tokens.includes('new');
    const key = [wanted, norm(eventName), norm(locale)].join('|');
    const prev = seen.get(key);
    if (prev !== undefined && !(isNew && !prev)) { diag('duplicate of a template already matched for this routing key'); continue; }
    if (prev !== undefined) {
      const i = matched.findIndex((m) => [audienceKey(m.audience), norm(m.eventName), norm(m.locale)].join('|') === key);
      if (i >= 0) matched.splice(i, 1);
    }
    seen.set(key, isNew);
    matched.push({ provider: 'twilio', channel: 'WHATSAPP', audience, eventName, locale, templateId: t.templateId, templateName: t.templateName, variables, approvalStatus: 'approved', active: true });
  }
  return { matched, unmatched };
}
