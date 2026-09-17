// Pure matcher: Twilio Content templates (name tokens + language + approval) → proposed
// RAINMAKER-PGR.NotificationProviderTemplate rows, using THIS tenant's own routing and
// template rows as the source of truth for audiences, actions, toStates and variables.
// (Previously a hand-copied action→toState→variables table inside novu-bridge.)

export interface TwilioTemplateMeta {
  templateId: string;
  templateName?: string;
  language?: string;
  approvalStatus?: string;
  tokens?: string[];
}

export interface RoutingLike { audience?: string; action?: string; toState?: string; channel?: string; active?: boolean | string }
export interface TemplateLike { audience?: string; action?: string; toState?: string; channel?: string; locale?: string; body?: string; placeholders?: string[]; active?: boolean | string }

export interface MatchedTemplate {
  provider: string;
  channel: string;
  audience: string;
  action: string;
  toState: string;
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

export function matchTwilioTemplates(
  templates: TwilioTemplateMeta[],
  routingRows: RoutingLike[],
  templateRows: TemplateLike[],
): { matched: MatchedTemplate[]; unmatched: UnmatchedTemplate[] } {
  const waRouting = routingRows.filter((r) => norm(r.channel) === 'WHATSAPP' && isActive(r.active));
  const audiences = new Set(waRouting.map((r) => norm(r.audience)));
  const actions = new Set(waRouting.map((r) => norm(r.action)));
  const matched: MatchedTemplate[] = [];
  const unmatched: UnmatchedTemplate[] = [];
  const seen = new Map<string, boolean>(); // dedupe key → isNew

  for (const t of templates) {
    const tokens = (t.tokens ?? []).map((x) => x.toLowerCase());
    const diag = (reason: string) => unmatched.push({ templateId: t.templateId, templateName: t.templateName, approvalStatus: t.approvalStatus, skipReason: reason });
    if (!tokens.includes('complaints') || !tokens.includes('message')) { diag('friendly_name does not match complaints_…_message[_new] convention'); continue; }
    // Audience: any token that is a routed WHATSAPP audience (role codes included); else CITIZEN.
    const audience = tokens.map(norm).find((x) => audiences.has(x)) ?? (tokens.includes('employee') ? 'EMPLOYEE' : 'CITIZEN');
    const action = tokens.map(norm).find((x) => actions.has(x));
    if (!action) { diag('no WHATSAPP routing row for any action named in this template'); continue; }
    if (String(t.approvalStatus ?? '').toLowerCase() !== 'approved') { diag("WhatsApp approval status is not 'approved'"); continue; }
    const candidates = waRouting.filter((r) => norm(r.audience) === audience && norm(r.action) === action);
    if (candidates.length === 0) { diag(`no WHATSAPP routing row for ${audience} / ${action}`); continue; }
    const byNameState = candidates.find((r) => tokens.includes(norm(r.toState).toLowerCase()));
    const toState = norm((byNameState ?? candidates[0]).toState);
    const locale = localeOf(tokens, t.language);
    const tpl = templateRows.find((x) => norm(x.audience) === audience && norm(x.action) === action && norm(x.toState) === toState && norm(x.channel) === 'WHATSAPP' && norm(x.locale) === norm(locale) && isActive(x.active))
      ?? templateRows.find((x) => norm(x.audience) === audience && norm(x.action) === action && norm(x.toState) === toState && norm(x.channel) === 'WHATSAPP' && isActive(x.active));
    const variables = tpl?.placeholders && tpl.placeholders.length > 0 ? tpl.placeholders : bodyTokens(tpl?.body);
    const isNew = tokens.includes('new');
    const key = [audience, action, toState, locale].join('|');
    const prev = seen.get(key);
    if (prev !== undefined && !(isNew && !prev)) { diag('duplicate of a template already matched for this routing key'); continue; }
    if (prev !== undefined) { const i = matched.findIndex((m) => [m.audience, m.action, m.toState, m.locale].join('|') === key); if (i >= 0) matched.splice(i, 1); }
    seen.set(key, isNew);
    matched.push({ provider: 'twilio', channel: 'WHATSAPP', audience, action, toState, locale, templateId: t.templateId, templateName: t.templateName, variables, approvalStatus: 'approved', active: true });
  }
  return { matched, unmatched };
}
