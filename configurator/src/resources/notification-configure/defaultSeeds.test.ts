/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  validateNotifications,
  resolveProviderTemplate,
  NOTIFICATION_RULES,
  type BusinessServiceRecord,
  type ChannelRow,
  type ProviderTemplateRow,
  type RoutingRow,
  type TemplateRow,
  type ValidationFinding,
} from '../workflow-services/validateNotifications';

/**
 * THE DEFAULT NOTIFICATION CONFIGURATION WE SHIP MUST PASS ITS OWN VALIDATOR.
 *
 * "Let's have an out-of-the-box message structure which is validated" — this is
 * the CI half of that promise. It loads the four seed masters exactly as
 * default-data-handler ships them and runs the same checker the Configure
 * screen runs, so a seed edit that breaks a message structure fails the build
 * instead of reaching a tenant.
 *
 * ERRORS: zero, always. WARNINGS: pinned below. A warning is a real cost or a
 * real gap (an SMS that will be billed as five parts, a channel that is off out
 * of the box); pinning the set means adding one is a deliberate act with a
 * diff, not something that accumulates unnoticed.
 *
 * The seeds are OUTSIDE this app, so this test reads them from the repo the way
 * validation.postalCode.test.ts reads its fixtures. It is pure — no React, no
 * app graph — so it runs without the configurator's runtime dependencies.
 */

/** Walk up from the vitest root (configurator/) to the repo root. The jsdom
 *  environment does not give this file a `file:` import.meta.url, so anchor on
 *  cwd and verify by a marker path rather than counting directories blindly. */
function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(resolve(dir, 'utilities/default-data-handler'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Could not locate the repo root from ${process.cwd()}`);
}

const REPO = repoRoot();
const SEEDS = resolve(REPO, 'utilities/default-data-handler/src/main/resources/mdmsData-dev/RAINMAKER-PGR');
/** The PGR state machine the dataloader ships; routing rows are checked against it. */
const WORKFLOW = resolve(REPO, 'local-setup/dataloader/templates/PgrWorkflowConfig.json');

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

const routingRows = readJson<RoutingRow[]>(resolve(SEEDS, 'RAINMAKER-PGR.NotificationRouting.json'));
const templateRows = readJson<TemplateRow[]>(resolve(SEEDS, 'RAINMAKER-PGR.NotificationTemplate.json'));
const channelRows = readJson<ChannelRow[]>(resolve(SEEDS, 'RAINMAKER-PGR.NotificationChannel.json'));
const providerTemplateRows = readJson<ProviderTemplateRow[]>(resolve(SEEDS, 'RAINMAKER-PGR.NotificationProviderTemplate.json'));

const workflow = readJson<{ BusinessServices: BusinessServiceRecord[] }>(WORKFLOW);
const pgr = workflow.BusinessServices.find((b) => b.businessService === 'PGR');

/** Role codes the shipped workflow itself declares — no hand-pinned tenant list. */
const roleCodes = Array.from(
  new Set((pgr?.states ?? []).flatMap((s) => (s.actions ?? []).flatMap((a) => a.roles ?? []))),
);

const DEFAULT_LOCALE = 'en_IN';
const up = (v: unknown) => String(v ?? '').trim().toUpperCase();
const active = (v: boolean | string | undefined) => v === undefined || up(v) !== 'FALSE';

function run(): ValidationFinding[] {
  return validateNotifications({
    businessService: pgr as BusinessServiceRecord,
    routingRows,
    templateRows,
    roleCodes,
    channelRows,
    providerTemplateRows,
    // Novu integrations are a per-deployment runtime fact, not seed data, so the
    // channel-provider-missing / -inactive rules are correctly out of scope here.
  });
}

/**
 * Every warning the shipped seeds produce, as `rule :: ref`. Each entry is a
 * KNOWN, ACCEPTED property of the default configuration — not a TODO list to be
 * silenced. Read the comments before adding to it.
 */
const EXPECTED_WARNINGS: string[] = [
  // Channels ship OFF. A fresh tenant has no provider credentials, so delivering
  // anything would be an error; the operator turns a channel on from
  // Notifications -> Channels once a provider is configured.
  'channel-enabled :: SMS',
  'channel-enabled :: WHATSAPP',
  'channel-enabled :: EMAIL',

  // The two EMPLOYEE-audience WhatsApp rows have no approved Twilio template.
  // The templates we shipped were approved for the CITIZEN wording only; the
  // routing rows are kept so an operator who gets employee templates approved
  // only has to add the provider-template rows. Until then novu-bridge records
  // those events SKIPPED / NB_TEMPLATE_NOT_APPROVED, which is auditable and safe.
  'whatsapp-needs-template :: EMPLOYEE · ASSIGN -> PENDINGATLME · WHATSAPP',
  'whatsapp-needs-template :: EMPLOYEE · RATE -> CLOSEDAFTERRESOLUTION · WHATSAPP',

  // Hindi SMS is UCS-2 (67 characters per part instead of 153), so the same
  // sentence costs 4-5 segments. That is a real billing fact about Devanagari,
  // not a defect in the wording: shortening these to 3 segments would mean
  // dropping information the citizen needs. Kept, with the cost visible.
  'sms-length :: CITIZEN · ASSIGN -> PENDINGATLME · SMS',
  'sms-length :: CITIZEN · REASSIGN -> PENDINGFORREASSIGNMENT · SMS',
  'sms-length :: CITIZEN · REJECT -> REJECTED · SMS',
  'sms-length :: CITIZEN · RESOLVE -> RESOLVED · SMS',
  'sms-length :: CITIZEN · REOPEN -> PENDINGFORASSIGNMENT · SMS',
];

describe('shipped notification seeds', () => {
  it('finds the PGR workflow to validate against', () => {
    expect(pgr, 'PgrWorkflowConfig.json must still carry a PGR BusinessService').toBeTruthy();
    expect(roleCodes.length).toBeGreaterThan(0);
  });

  it('produces ZERO validator errors', () => {
    const errors = run().filter((f) => f.level === 'error');
    expect(errors.map((e) => `${e.rule} :: ${e.ref ?? ''} :: ${e.message}`)).toEqual([]);
  });

  it('produces only the warnings we have accepted', () => {
    const warnings = run()
      .filter((f) => f.level === 'warn')
      .map((f) => `${f.rule} :: ${f.ref ?? ''}`)
      .sort();
    expect(warnings).toEqual([...EXPECTED_WARNINGS].sort());
  });

  it('emits no rule that is missing from the documented rule table', () => {
    const known = new Set(NOTIFICATION_RULES.map((r) => r.id));
    for (const f of run()) expect(known, `rule "${f.rule}" is not in NOTIFICATION_RULES`).toContain(f.rule);
  });
});

// ---------------------------------------------------------------------------
// Structural completeness the rule set does not (or cannot) cover row by row.
// ---------------------------------------------------------------------------
describe('shipped notification seeds — structure', () => {
  it('gives every active routing row a default-locale template on its own channel', () => {
    const have = new Set(
      templateRows
        .filter((t) => active(t.active) && up(t.locale) === up(DEFAULT_LOCALE))
        .map((t) => [up(t.audience), up(t.action), up(t.toState), up(t.channel)].join('|')),
    );
    const missing = routingRows
      .filter((r) => active(r.active))
      .map((r) => [up(r.audience), up(r.action), up(r.toState), up(r.channel)].join('|'))
      .filter((k) => !have.has(k));
    expect(missing).toEqual([]);
  });

  it('does not ship a template for a key nothing routes to', () => {
    const routed = new Set(
      routingRows
        .filter((r) => active(r.active))
        .map((r) => [up(r.audience), up(r.action), up(r.toState), up(r.channel)].join('|')),
    );
    const orphans = templateRows
      .filter((t) => active(t.active))
      .map((t) => [up(t.audience), up(t.action), up(t.toState), up(t.channel), up(t.locale)].join('|'))
      .filter((k) => !routed.has(k.split('|').slice(0, 4).join('|')));
    expect(orphans).toEqual([]);
  });

  it('gives every WhatsApp template either a resolvable provider template or a known gap', () => {
    // Known gap: the EMPLOYEE-audience rows, for the reason in EXPECTED_WARNINGS.
    const KNOWN_GAPS = ['EMPLOYEE|ASSIGN|PENDINGATLME', 'EMPLOYEE|RATE|CLOSEDAFTERRESOLUTION'];
    const unresolved = templateRows
      .filter((t) => active(t.active) && up(t.channel) === 'WHATSAPP')
      .filter((t) => !resolveProviderTemplate(providerTemplateRows, t, DEFAULT_LOCALE))
      .map((t) => [up(t.audience), up(t.action), up(t.toState)].join('|'));
    expect(Array.from(new Set(unresolved)).sort()).toEqual([...KNOWN_GAPS].sort());
  });

  it('has no colliding uniqueness keys in any of the four masters', () => {
    // These are the MDMS `x-unique` tuples. A collision means the second row
    // silently overwrites the first at seed time.
    const dupes = (keys: string[]) => keys.filter((k, i) => keys.indexOf(k) !== i);
    expect(dupes(routingRows.map((r) => [r.businessService, r.action, r.toState, r.audience, r.channel].join('.')))).toEqual([]);
    expect(dupes(templateRows.map((t) => [t.audience, t.action, t.toState, t.channel, t.locale].join('.')))).toEqual([]);
    expect(dupes(channelRows.map((c) => String(c.code)))).toEqual([]);
    expect(dupes(providerTemplateRows.map((p) => [p.provider, p.channel, p.audience, p.action, p.toState, p.locale].join('.')))).toEqual([]);
  });

  it('declares a `placeholders` list on every template that matches its body', () => {
    // `placeholders` is documentation the Configure screen regenerates on save;
    // a stale list is how an operator ends up editing the wrong token.
    for (const t of templateRows) {
      const declared = ((t as { placeholders?: string[] }).placeholders ?? []).slice().sort();
      const used = Array.from(new Set([...String(t.body ?? '').matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]))).sort();
      expect(declared, `${t.audience}.${t.action}.${t.toState}.${t.channel}.${t.locale}`).toEqual(used);
    }
  });
});
