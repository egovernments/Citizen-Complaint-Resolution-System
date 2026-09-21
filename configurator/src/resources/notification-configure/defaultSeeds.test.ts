/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  validateNotifications,
  resolveProviderTemplate,
  NOTIFICATION_RULES,
  type ProviderTemplateRow,
  type RoutingRow,
  type TemplateRow,
  type ValidationFinding,
} from '../workflow-services/validateNotifications';
import {
  adaptLegacyProviderTemplate,
  adaptLegacyRouting,
  adaptLegacyTemplate,
  catalogueFromWorkflow,
  type BusinessServiceRecord,
  type LegacyProviderTemplateRow,
  type LegacyRoutingRow,
  type LegacyTemplateRow,
} from './legacyAdapter';
import { audienceKey } from './audienceScheme';
import type { EventCatalogueRow } from './eventCatalogue';

/**
 * THE DEFAULT NOTIFICATION CONFIGURATION WE SHIP MUST PASS ITS OWN VALIDATOR.
 *
 * "Let's have an out-of-the-box message structure which is validated" — this is
 * the CI half of that promise. It loads the seed masters exactly as
 * default-data-handler ships them and runs the same checker the Configure
 * screen runs, so a seed edit that breaks a message structure fails the build
 * instead of reaching a tenant.
 *
 * ERRORS: zero, always. WARNINGS: pinned below. A warning is a real cost or a
 * real gap (an SMS that will be billed as five parts, a channel that is off out
 * of the box); pinning the set means adding one is a deliberate act with a
 * diff, not something that accumulates unnoticed.
 *
 * TWO SUITES, because the repo is mid-migration:
 *   - the LEGACY seeds (RAINMAKER-PGR.Notification*), read through the same
 *     adapter the screens use, validated against a catalogue generated from the
 *     shipped PGR workflow — which is what keeps `transition-exists` meaningful
 *     here rather than tautological;
 *   - the NEW seeds (NOTIFICATIONS/*), which land with the seeder work. Until
 *     that directory exists the new suite skips with a named guard; the MOMENT
 *     the directory appears, a missing file inside it FAILS rather than skips.
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
const MDMS_DATA = resolve(REPO, 'utilities/default-data-handler/src/main/resources/mdmsData-dev');
const LEGACY_SEEDS = resolve(MDMS_DATA, 'RAINMAKER-PGR');
const NEW_SEEDS = resolve(MDMS_DATA, 'NOTIFICATIONS');
/** The PGR state machine the dataloader ships; the catalogue is generated from it. */
const WORKFLOW = resolve(REPO, 'local-setup/dataloader/templates/PgrWorkflowConfig.json');

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

const DEFAULT_LOCALE = 'en_IN';
const up = (v: unknown) => String(v ?? '').trim().toUpperCase();
const active = (v: boolean | string | undefined) => v === undefined || up(v) !== 'FALSE';

// ---------------------------------------------------------------------------
// LEGACY seeds — read through the adapter, as an un-migrated tenant sees them.
// ---------------------------------------------------------------------------
const legacyRouting = readJson<LegacyRoutingRow[]>(resolve(LEGACY_SEEDS, 'RAINMAKER-PGR.NotificationRouting.json'));
const legacyTemplates = readJson<LegacyTemplateRow[]>(resolve(LEGACY_SEEDS, 'RAINMAKER-PGR.NotificationTemplate.json'));
const legacyChannels = readJson<Array<{ code?: string; enabled?: boolean; active?: boolean }>>(resolve(LEGACY_SEEDS, 'RAINMAKER-PGR.NotificationChannel.json'));
const legacyProviderTemplates = readJson<LegacyProviderTemplateRow[]>(resolve(LEGACY_SEEDS, 'RAINMAKER-PGR.NotificationProviderTemplate.json'));

const workflow = readJson<{ BusinessServices: BusinessServiceRecord[] }>(WORKFLOW);
const pgr = workflow.BusinessServices.find((b) => b.businessService === 'PGR');

/** Role codes the shipped workflow itself declares — no hand-pinned tenant list. */
const roleCodes = Array.from(
  new Set((pgr?.states ?? []).flatMap((s) => (s.actions ?? []).flatMap((a) => a.roles ?? []))),
);

/** Exactly what the seed-time generator will emit for PGR. */
const generatedCatalogue = catalogueFromWorkflow(pgr);

const routingRows = adaptLegacyRouting(legacyRouting);
const templateRows = adaptLegacyTemplate(legacyTemplates);
const providerTemplateRows = adaptLegacyProviderTemplate(legacyProviderTemplates);

function run(): ValidationFinding[] {
  return validateNotifications({
    catalogue: generatedCatalogue,
    routingRows,
    templateRows,
    roleCodes,
    channelRows: legacyChannels,
    providerTemplateRows,
    // Novu integrations are a per-deployment runtime fact, not seed data, so the
    // channel-provider-missing / -inactive rules are correctly out of scope here.
  });
}

/**
 * Every warning the shipped seeds produce, as `rule :: ref`. Each entry is a
 * KNOWN, ACCEPTED property of the default configuration — not a TODO list to be
 * silenced. Read the comments before adding to it.
 *
 * The refs now read `AUDIENCE · EVENT · CHANNEL` with the audience canonicalised
 * (`CITIZEN` is stored, `ACTOR:CITIZEN` is what the box resolves) — the seeds
 * themselves did not change.
 */
const EXPECTED_WARNINGS: string[] = [
  // Channels ship OFF. A fresh tenant has no provider credentials, so delivering
  // anything would be an error; the operator turns a channel on from
  // Notifications -> Channels once a provider is configured.
  'channel-enabled :: SMS',
  'channel-enabled :: WHATSAPP',
  'channel-enabled :: EMAIL',

  // The two assignee-audience WhatsApp rows have no approved Twilio template.
  // The templates we shipped were approved for the citizen wording only; the
  // routing rows are kept so an operator who gets employee templates approved
  // only has to add the provider-template rows. Until then novu-bridge records
  // those events SKIPPED / NB_TEMPLATE_NOT_APPROVED, which is auditable and safe.
  'whatsapp-needs-template :: ACTOR:ASSIGNEE · COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME · WHATSAPP',
  'whatsapp-needs-template :: ACTOR:ASSIGNEE · COMPLAINTS.WORKFLOW.RATE.CLOSEDAFTERRESOLUTION · WHATSAPP',

  // Hindi SMS is UCS-2 (67 characters per part instead of 153), so the same
  // sentence costs 4-5 segments. That is a real billing fact about Devanagari,
  // not a defect in the wording: shortening these to 3 segments would mean
  // dropping information the citizen needs. Kept, with the cost visible.
  'sms-length :: ACTOR:CITIZEN · COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME · SMS',
  'sms-length :: ACTOR:CITIZEN · COMPLAINTS.WORKFLOW.REASSIGN.PENDINGFORREASSIGNMENT · SMS',
  'sms-length :: ACTOR:CITIZEN · COMPLAINTS.WORKFLOW.REJECT.REJECTED · SMS',
  'sms-length :: ACTOR:CITIZEN · COMPLAINTS.WORKFLOW.RESOLVE.RESOLVED · SMS',
  'sms-length :: ACTOR:CITIZEN · COMPLAINTS.WORKFLOW.REOPEN.PENDINGFORASSIGNMENT · SMS',
];

describe('shipped notification seeds (legacy masters, read through the adapter)', () => {
  it('finds the PGR workflow to generate the catalogue from', () => {
    expect(pgr, 'PgrWorkflowConfig.json must still carry a PGR BusinessService').toBeTruthy();
    expect(roleCodes.length).toBeGreaterThan(0);
    expect(generatedCatalogue.length).toBeGreaterThan(0);
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
// Asserted on the ADAPTED rows, i.e. on what the box actually resolves.
// ---------------------------------------------------------------------------
describe('shipped notification seeds — structure', () => {
  const key = (r: { audience?: string; eventName?: string; channel?: string }) =>
    [audienceKey(r.audience), up(r.eventName), up(r.channel)].join('|');

  it('gives every active routing row a default-locale template on its own channel', () => {
    const have = new Set(
      templateRows.filter((t) => active(t.active) && up(t.locale) === up(DEFAULT_LOCALE)).map(key),
    );
    const missing = routingRows.filter((r) => active(r.active)).map(key).filter((k) => !have.has(k));
    expect(missing).toEqual([]);
  });

  it('does not ship a template for a key nothing routes to', () => {
    const routed = new Set(routingRows.filter((r) => active(r.active)).map(key));
    const orphans = templateRows.filter((t) => active(t.active)).map(key).filter((k) => !routed.has(k));
    expect(orphans).toEqual([]);
  });

  it('gives every WhatsApp template either a resolvable provider template or a known gap', () => {
    // Known gap: the assignee-audience rows, for the reason in EXPECTED_WARNINGS.
    const KNOWN_GAPS = [
      'ACTOR:ASSIGNEE|COMPLAINTS.WORKFLOW.ASSIGN.PENDINGATLME',
      'ACTOR:ASSIGNEE|COMPLAINTS.WORKFLOW.RATE.CLOSEDAFTERRESOLUTION',
    ];
    const unresolved = templateRows
      .filter((t) => active(t.active) && up(t.channel) === 'WHATSAPP')
      .filter((t) => !resolveProviderTemplate(providerTemplateRows, t, DEFAULT_LOCALE))
      .map((t) => [audienceKey(t.audience), up(t.eventName)].join('|'));
    expect(Array.from(new Set(unresolved)).sort()).toEqual([...KNOWN_GAPS].sort());
  });

  it('has no colliding uniqueness keys in any of the four legacy masters', () => {
    // These are the MDMS `x-unique` tuples ON DISK (still the legacy ones). A
    // collision means the second row silently overwrites the first at seed time.
    const dupes = (keys: string[]) => keys.filter((k, i) => keys.indexOf(k) !== i);
    expect(dupes(legacyRouting.map((r) => [r.businessService, r.action, r.toState, r.audience, r.channel].join('.')))).toEqual([]);
    expect(dupes(legacyTemplates.map((t) => [t.audience, t.action, t.toState, t.channel, t.locale].join('.')))).toEqual([]);
    expect(dupes(legacyChannels.map((c) => String(c.code)))).toEqual([]);
    expect(dupes(legacyProviderTemplates.map((p) => [p.provider, p.channel, p.audience, p.action, p.toState, p.locale].join('.')))).toEqual([]);
  });

  it('does not collide after the adaptation either', () => {
    // The adapter drops `businessService` and `fromState` and folds
    // `assigneeOnly` into the audience chain. Two legacy rows that differed ONLY
    // in a dropped field would collapse into one row after the copy — silently,
    // because the seeder is create-only and reports the second as a duplicate.
    const dupes = (keys: string[]) => keys.filter((k, i) => keys.indexOf(k) !== i);
    expect(dupes(routingRows.map(key))).toEqual([]);
    expect(dupes(templateRows.map((t) => `${key(t)}|${up(t.locale)}`))).toEqual([]);
  });

  it('declares a `placeholders` list on every template that matches its body', () => {
    // `placeholders` is documentation the Configure screen regenerates on save;
    // a stale list is how an operator ends up editing the wrong token.
    for (const t of legacyTemplates) {
      const declared = (t.placeholders ?? []).slice().sort();
      const used = Array.from(new Set([...String(t.body ?? '').matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]))).sort();
      expect(declared, `${t.audience}.${t.action}.${t.toState}.${t.channel}.${t.locale}`).toEqual(used);
    }
  });
});

// ---------------------------------------------------------------------------
// NEW seeds (NOTIFICATIONS/*). Written against the design's shapes; guarded so
// it skips while the directory does not exist and FAILS the moment it does but
// a file inside it is missing.
// ---------------------------------------------------------------------------
const NEW_SEED_FILES = {
  catalogue: 'NOTIFICATIONS.EventCatalogue.json',
  routing: 'NOTIFICATIONS.Routing.json',
  template: 'NOTIFICATIONS.Template.json',
  providerTemplate: 'NOTIFICATIONS.ProviderTemplate.json',
  channel: 'NOTIFICATIONS.Channel.json',
} as const;

const newSeedsPresent = existsSync(NEW_SEEDS);

describe.skipIf(!newSeedsPresent)('shipped notification seeds (NOTIFICATIONS.* namespace)', () => {
  it('ships every master the design names — a missing one is a failure, not a skip', () => {
    const present = readdirSync(NEW_SEEDS);
    const missing = Object.values(NEW_SEED_FILES).filter((f) => !present.includes(f));
    expect(
      missing,
      `${NEW_SEEDS} exists, so the migration has started: every NOTIFICATIONS master must ship a seed file. Present: ${present.join(', ') || 'nothing'}`,
    ).toEqual([]);
  });

  it('passes its own validator with zero errors', () => {
    const catalogue = readJson<EventCatalogueRow[]>(resolve(NEW_SEEDS, NEW_SEED_FILES.catalogue));
    const findings = validateNotifications({
      catalogue,
      routingRows: readJson<RoutingRow[]>(resolve(NEW_SEEDS, NEW_SEED_FILES.routing)),
      templateRows: readJson<TemplateRow[]>(resolve(NEW_SEEDS, NEW_SEED_FILES.template)),
      roleCodes,
      channelRows: readJson<Array<{ code?: string; enabled?: boolean; active?: boolean }>>(resolve(NEW_SEEDS, NEW_SEED_FILES.channel)),
      providerTemplateRows: readJson<ProviderTemplateRow[]>(resolve(NEW_SEEDS, NEW_SEED_FILES.providerTemplate)),
    });
    expect(findings.filter((f) => f.level === 'error').map((e) => `${e.rule} :: ${e.ref ?? ''} :: ${e.message}`)).toEqual([]);
  });

  it('declares a module, a unique event name and at least one placeholder per catalogue row', () => {
    const catalogue = readJson<EventCatalogueRow[]>(resolve(NEW_SEEDS, NEW_SEED_FILES.catalogue));
    expect(catalogue.length).toBeGreaterThan(0);
    const names = catalogue.map((e) => up(e.eventName));
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
    for (const e of catalogue) {
      expect(String(e.module ?? '').trim(), String(e.eventName)).not.toBe('');
      expect((e.placeholders ?? []).length, String(e.eventName)).toBeGreaterThan(0);
      expect((e.actors ?? []).length, String(e.eventName)).toBeGreaterThan(0);
    }
  });

  it('carries every legacy seed row forward — the copy must not lose a notification', () => {
    const routing = readJson<RoutingRow[]>(resolve(NEW_SEEDS, NEW_SEED_FILES.routing));
    const have = new Set(routing.map((r) => [audienceKey(r.audience), up(r.eventName), up(r.channel)].join('|')));
    const missing = routingRows
      .filter((r) => active(r.active))
      .map((r) => [audienceKey(r.audience), up(r.eventName), up(r.channel)].join('|'))
      .filter((k) => !have.has(k));
    expect(missing).toEqual([]);
  });
});
