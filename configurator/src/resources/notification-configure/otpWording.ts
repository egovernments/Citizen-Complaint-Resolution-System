// Login / registration / password-reset OTP wording: the pure half.
//
// The OTP SMS is NOT a NOTIFICATIONS.* template. DIGIT core's user-otp service
// (egovio/user-otp, not in this repo) builds the finished text itself and
// publishes it to egov.core.notification.sms; novu-bridge only delivers it. The
// one thing an operator can change is the wording, which user-otp reads from
// three localization messages. Everything below mirrors how user-otp and
// egov-localization actually behave (read from the running images' bytecode:
// OtpSMSRepository, LocalizationService, MessageService, MessageCacheRepository),
// so the Configure screen shows the text that is really sent and refuses a save
// that would break OTP login.
//
// HOW user-otp PICKS THE TEXT (OtpSMSRepository.getMessageFormat)
//   tenant   the OTP request's tenantId minus EGOV_LOCALISATION_TENANTID_STRIP_SUFFIX_COUNT
//            (1) trailing segments: mz.maputo -> mz. A tenant with no more segments than
//            that keeps its first one: mz -> mz.
//   locale   the part after '|' in RequestInfo.msgId (DIGIT UI sends `<ts>|<its current
//            language>`), else egov.localization.default.locale = en_IN.
//   module   egov-user. One /localization/messages/v1/_search per OTP; user-otp keeps
//            no copy between OTPs.
//   fallback ONLY when that search returns NO message at all. Then the three built-in
//            English texts below are used. If the module has ANY message in that
//            language but not the code for this OTP type, the text is null,
//            String.format throws, the OTP request fails and no SMS is sent. So a
//            language either has none of the three codes or all of them; a save here
//            always writes all three.
//   format   String.format(text, otp), one argument:
//              no %s     -> sent WITHOUT the code (extra arguments are ignored)
//              two %s    -> MissingFormatArgumentException, nothing sent
//              other %x  -> IllegalFormatException or a mangled text; %% is a literal %
//
// HOW egov-localization ANSWERS THAT SEARCH (MessageService.getFilteredMessages)
//   Only messages in the requested locale (no en_IN fill-in for a module-scoped
//   search), from the most specific tenant level that has ANY egov-user message:
//   mz, then default. Writing the first egov-user message at mz therefore hides
//   whatever the default level holds for mz. Its Redis cache has no TTL; _upsert
//   and _delete clear the entries for that tenant + locale, so a change made
//   through the API is used by the very next OTP.
//
// Pure and React-free so it can be tested without the app graph.

import { measureSms, type SmsMeasurement } from './smsSegments';
import type { ValidationFinding } from '../workflow-services/validateNotifications';

/** Localization module user-otp reads (`egov.localization.module`). */
export const OTP_LOCALIZATION_MODULE = 'egov-user';
/** Locale user-otp asks for when the request names none (`egov.localization.default.locale`). */
export const OTP_DEFAULT_LOCALE = 'en_IN';
/** `EGOV_LOCALISATION_TENANTID_STRIP_SUFFIX_COUNT` on the deployed user-otp. */
export const OTP_TENANT_STRIP_SUFFIX_COUNT = 1;
/** A stand-in code for previews and length estimates (`EGOV_OTP_LENGTH` is 6). */
export const OTP_SAMPLE_CODE = '123456';
/** The access-control action the localization write needs (same as the Localization screens). */
export const LOCALIZATION_UPSERT_ACTION_URL = '/localization/messages/v1/_upsert';

/** The OTP request `type` each message serves. Anything not login/register is a password reset. */
export type OtpPurpose = 'login' | 'register' | 'passwordreset';

export interface OtpMessageSpec {
  code: string;
  purpose: OtpPurpose;
  /** What user-otp sends when the module holds no message for the language. */
  builtInDefault: string;
}

export const OTP_MESSAGES: readonly OtpMessageSpec[] = [
  { code: 'sms.login.otp.msg', purpose: 'login', builtInDefault: 'Dear Citizen, Your Login OTP is %s.' },
  {
    code: 'sms.register.otp.msg',
    purpose: 'register',
    builtInDefault: 'Dear Citizen, Your OTP to complete your DIGIT Registration is %s.',
  },
  {
    code: 'sms.pwd.reset.otp.msg',
    purpose: 'passwordreset',
    builtInDefault: 'Dear Citizen, Your OTP for recovering password is %s.',
  },
];

const SPEC_BY_CODE = new Map(OTP_MESSAGES.map((m) => [m.code, m]));

export function isOtpCode(code: string): boolean {
  return SPEC_BY_CODE.has(code);
}

// ---------------------------------------------------------------------------
// Tenant and locale resolution
// ---------------------------------------------------------------------------

/** The tenant user-otp looks the wording up at, for an OTP requested on `tenantId`. */
export function otpLookupTenant(tenantId: string, stripSuffixCount: number = OTP_TENANT_STRIP_SUFFIX_COUNT): string {
  const parts = tenantId.split('.');
  if (stripSuffixCount > 0 && stripSuffixCount < parts.length) {
    return parts.slice(0, parts.length - stripSuffixCount).join('.');
  }
  if (stripSuffixCount >= parts.length) return parts[0];
  return tenantId;
}

/**
 * The next tenant level egov-localization falls back to when `tenantId` has no
 * message for a module (Tenant.getTenantHierarchy): drop the last segment, and
 * after the root comes `default`. `default` has no parent.
 */
export function localizationParentTenant(tenantId: string): string | null {
  if (!tenantId || tenantId === 'default') return null;
  const dot = tenantId.lastIndexOf('.');
  return dot > 0 ? tenantId.slice(0, dot) : 'default';
}

/**
 * The languages to offer: en_IN first (user-otp's default, always used), then
 * the tenant's own languages. `default` is DIGIT's UI-string bucket, not a
 * language anyone's app sends, so it is dropped.
 */
export function otpLocales(tenantLocales: string[]): string[] {
  const out = [OTP_DEFAULT_LOCALE];
  for (const l of tenantLocales) {
    const v = String(l ?? '').trim();
    if (v && v !== 'default' && !out.includes(v)) out.push(v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// What is sent today
// ---------------------------------------------------------------------------

/** One localization message as the search returns it. */
export interface LocalizationRow {
  code?: unknown;
  message?: unknown;
  module?: unknown;
}

/** The two searches the effective text depends on, for one language. */
export interface OtpLocaleRead {
  locale: string;
  /** egov-user messages the search at the lookup tenant returns: exactly what user-otp gets. */
  effective: LocalizationRow[];
  /** The same search at the next tenant level up; empty when there is none. */
  parent: LocalizationRow[];
}

export type OtpTextSource = 'built-in' | 'localization' | 'missing';

export interface OtpEffectiveText extends OtpMessageSpec {
  source: OtpTextSource;
  /** The text user-otp formats, or null when the OTP of this type fails. */
  text: string | null;
  /** True when a stored message is word-for-word the built-in default. */
  matchesBuiltIn: boolean;
}

export interface OtpLocaleState {
  locale: string;
  /** code -> message, as user-otp builds its map (last one wins). */
  effective: Map<string, string>;
  /** True when the effective messages are the parent level's, not the lookup tenant's own. */
  inherited: boolean;
  /** True when the next tenant level up holds any egov-user message in this language. */
  parentHasModule: boolean;
  /** egov-user codes in the effective set that are not OTP codes. */
  otherCodes: string[];
  messages: OtpEffectiveText[];
  /** True when at least one OTP type fails in this language today. */
  broken: boolean;
}

function toMap(rows: LocalizationRow[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of rows ?? []) {
    const mod = r?.module;
    if (mod != null && String(mod) !== OTP_LOCALIZATION_MODULE) continue;
    const code = String(r?.code ?? '');
    if (code) m.set(code, String(r?.message ?? ''));
  }
  return m;
}

function sameMap(a: Map<string, string>, b: Map<string, string>): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

/** Resolve what each OTP type sends in one language, exactly as user-otp decides it. */
export function resolveOtpLocale(read: OtpLocaleRead): OtpLocaleState {
  const effective = toMap(read.effective);
  const parent = toMap(read.parent);
  const messages: OtpEffectiveText[] = OTP_MESSAGES.map((spec) => {
    if (effective.size === 0) {
      return { ...spec, source: 'built-in', text: spec.builtInDefault, matchesBuiltIn: true };
    }
    const text = effective.get(spec.code);
    if (text === undefined) return { ...spec, source: 'missing', text: null, matchesBuiltIn: false };
    return { ...spec, source: 'localization', text, matchesBuiltIn: text === spec.builtInDefault };
  });
  return {
    locale: read.locale,
    effective,
    // Identical content at both levels means either the lookup tenant holds
    // nothing of its own, or holds the same thing: either way a write at the
    // lookup tenant must carry the whole set to keep the other codes working.
    inherited: effective.size > 0 && parent.size > 0 && sameMap(effective, parent),
    parentHasModule: parent.size > 0,
    otherCodes: [...effective.keys()].filter((c) => !isOtpCode(c)).sort(),
    messages,
    broken: messages.some((m) => m.source === 'missing'),
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface OtpFormatScan {
  /** How many `%s` the text holds: the slots String.format fills with the code. */
  codeSlots: number;
  /** Every other `%` sequence, as written (a trailing lone `%` reads as '%'). */
  otherSpecifiers: string[];
}

/** Read `text` the way java.util.Formatter does, for the only two sequences allowed. */
export function scanOtpFormat(text: string): OtpFormatScan {
  let codeSlots = 0;
  const otherSpecifiers: string[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '%') continue;
    const next = text[i + 1];
    if (next === '%') { i++; continue; }
    if (next === 's') { codeSlots++; i++; continue; }
    // Anything else is a conversion Formatter tries to apply (or rejects).
    // Report it with the character after it so the operator can find it.
    otherSpecifiers.push(next === undefined ? '%' : `%${next}`);
    if (next !== undefined) i++;
  }
  return { codeSlots, otherSpecifiers };
}

/** The SMS as a citizen would receive it, with `code` in the `%s` slot. */
export function renderOtpSms(text: string, code: string = OTP_SAMPLE_CODE): string {
  return text.replace(/%%|%s/g, (m) => (m === '%%' ? '%' : code));
}

/** Length estimate of the rendered SMS (the code counted as 6 digits). */
export function measureOtpSms(text: string): SmsMeasurement {
  // No {placeholder} allowance: user-otp substitutes nothing but %s.
  return measureSms(renderOtpSms(text), { allowancePerPlaceholder: 0 });
}

/** Rule ids, their level and meaning — the doc section is written from this. */
export const OTP_RULES: ReadonlyArray<{ id: string; level: 'error' | 'warn'; summary: string }> = [
  { id: 'otp-needs-text', level: 'error', summary: 'The wording is empty.' },
  { id: 'otp-code-slot', level: 'error', summary: 'The wording must hold %s exactly once: without it the SMS carries no code, with two the OTP service fails and sends nothing.' },
  { id: 'otp-format', level: 'error', summary: 'A % sequence other than %s or %% makes the OTP service fail or garble the text.' },
  { id: 'otp-sms-length', level: 'warn', summary: 'The SMS (with a 6-digit code) is longer than one segment.' },
  { id: 'otp-locale-unused', level: 'warn', summary: 'The language is not in the tenant\'s language list.' },
];

/** Findings for a proposed OTP wording in `locale`. Errors block the save; warnings do not. */
export function validateOtpWording(
  text: string,
  ctx: { locale: string; tenantLocales: string[] },
): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const ref = ctx.locale;

  if (!text.trim()) {
    findings.push({ level: 'error', rule: 'otp-needs-text', message: 'The wording is empty; write the message and put %s where the code goes.', ref });
    return findings;
  }

  const { codeSlots, otherSpecifiers } = scanOtpFormat(text);
  if (codeSlots === 0) {
    const braces = /\{[^}]*\}/.test(text)
      ? ' {tokens} are not filled in here; the OTP service only replaces %s.'
      : '';
    findings.push({
      level: 'error',
      rule: 'otp-code-slot',
      message: `There is no %s, so the SMS would go out without the code.${braces} Put %s where the code goes.`,
      ref,
    });
  } else if (codeSlots > 1) {
    findings.push({
      level: 'error',
      rule: 'otp-code-slot',
      message: `%s appears ${codeSlots} times. The OTP service fills in one value, so it would fail and send nothing. Keep exactly one %s.`,
      ref,
    });
  }
  if (otherSpecifiers.length > 0) {
    const list = [...new Set(otherSpecifiers)].join(', ');
    findings.push({
      level: 'error',
      rule: 'otp-format',
      message: `${list} would make the OTP service fail or garble the SMS. Only %s (the code) is allowed; write %% for a literal percent sign.`,
      ref,
    });
  }

  if (codeSlots === 1 && otherSpecifiers.length === 0) {
    const m = measureOtpSms(text);
    if (m.segments > 1) {
      const why = m.encoding === 'UCS-2'
        ? `"${m.forcedUcs2By}" is not a GSM-7 character, so the whole SMS is sent as UCS-2 (70 characters in one segment)`
        : 'one GSM-7 segment holds 160 characters';
      findings.push({
        level: 'warn',
        rule: 'otp-sms-length',
        message: `With a 6-digit code this SMS is ${m.units} characters, ${m.segments} segments: ${why}. Each segment is billed, and a split OTP can arrive in pieces.`,
        ref,
      });
    }
  }

  const known = ctx.tenantLocales.filter((l) => l && l !== 'default');
  if (!known.includes(ctx.locale)) {
    findings.push({
      level: 'warn',
      rule: 'otp-locale-unused',
      message: ctx.locale === OTP_DEFAULT_LOCALE
        ? `${OTP_DEFAULT_LOCALE} is not in this tenant's language list, but the OTP service still uses it for any request that names no language.`
        : `${ctx.locale} is not in this tenant's language list (StateInfo), so no citizen app asks for it and this wording would not be used.`,
      ref,
    });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** One message for DigitApiClient.localizationUpsert (the locale is passed alongside). */
export interface OtpWrite {
  code: string;
  message: string;
  module: string;
}

/**
 * The messages to upsert, in ONE request, to set `code` to `text` in the state's
 * language. Always all three OTP codes: once the language holds any egov-user
 * message, a missing code makes that OTP type fail. The other two keep the text
 * they send today. When the lookup tenant inherits its egov-user messages from
 * the level above, the whole inherited set is written too, so the first local
 * write does not hide the codes it inherited.
 */
export function planOtpSave(state: OtpLocaleState, code: string, text: string): OtpWrite[] {
  const writes: OtpWrite[] = [];
  if (state.inherited) {
    for (const c of state.otherCodes) {
      writes.push({ code: c, message: state.effective.get(c) ?? '', module: OTP_LOCALIZATION_MODULE });
    }
  }
  for (const spec of OTP_MESSAGES) {
    const message = spec.code === code ? text : (state.effective.get(spec.code) ?? spec.builtInDefault);
    writes.push({ code: spec.code, message, module: OTP_LOCALIZATION_MODULE });
  }
  return writes;
}

export type OtpResetPlan =
  | { kind: 'none' }
  | { kind: 'delete'; codes: string[] }
  | { kind: 'upsert'; writes: OtpWrite[] };

/**
 * What "Reset to default" does for `code` in the state's language.
 *
 *   delete  only when removing the stored OTP messages leaves the lookup tenant with
 *           NO egov-user message in that language and nothing to fall back to above
 *           it, and all three would read as the defaults anyway. user-otp is then
 *           back on its built-in text.
 *   upsert  otherwise: write the built-in text for this code as a stored message.
 *           Deleting only this code would leave the language holding other egov-user
 *           messages, and user-otp would fail every OTP of this type.
 *   none    already on the built-in text.
 */
export function planOtpReset(state: OtpLocaleState, code: string): OtpResetPlan {
  const spec = SPEC_BY_CODE.get(code);
  if (!spec || state.effective.size === 0) return { kind: 'none' };
  const writes = planOtpSave(state, code, spec.builtInDefault);
  const allDefault = writes
    .filter((w) => isOtpCode(w.code))
    .every((w) => w.message === SPEC_BY_CODE.get(w.code)!.builtInDefault);
  if (allDefault && !state.inherited && !state.parentHasModule && state.otherCodes.length === 0) {
    return { kind: 'delete', codes: OTP_MESSAGES.map((m) => m.code).filter((c) => state.effective.has(c)) };
  }
  const unchanged = writes.every((w) => state.effective.get(w.code) === w.message);
  return unchanged ? { kind: 'none' } : { kind: 'upsert', writes };
}
