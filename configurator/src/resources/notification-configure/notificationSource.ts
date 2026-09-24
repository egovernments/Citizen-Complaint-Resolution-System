// WHICH NAMESPACE IS THIS TENANT'S CONFIGURATION IN?
//
// During the transition a tenant is in exactly one of three states, and the
// screens must behave correctly in all three:
//
//   NOTIFICATIONS  the copy has run — `NOTIFICATIONS.Routing` holds a record,
//                  so `NOTIFICATIONS.*` holds the configuration. Read and
//                  WRITE there. The legacy masters are read-only history.
//                  (Also: nothing is routed in EITHER namespace but the new
//                  masters are seeded — writable, since no route can stop.)
//   LEGACY         the images are new but the tenant has not been migrated
//                  (migrate-notifications.py — a deploy never moves a tenant's
//                  configuration): `NOTIFICATIONS.Routing` is empty and the
//                  legacy routing master is not. The `RAINMAKER-PGR.Notification*`
//                  rows are still the live configuration, and the box reads them
//                  through its own adapter. Show them, adapted, READ-ONLY, and
//                  say why.
//   NONE           neither namespace has a row. Nothing has been seeded: a fresh
//                  install whose seed has not run, or an upgraded tenant that ran
//                  2.12's hard-coded notifications and waits for its defaults.
//
// THE DECISION IS PER TENANT AND ALL-OR-NOTHING, NEVER PER ROW. Per-row
// precedence between two namespaces is the kind of thing nobody can reason
// about at 2am: an operator would see a screen that is half one vocabulary and
// half the other, and a row they "fixed" in the new namespace would sit behind
// a legacy row the box still preferred.
//
// AND IT IS THE BOX'S DECISION, MIRRORED, NOT A SECOND OPINION. novu-bridge
// switches on ONE master: NOTIFICATIONS.Routing for the configuration
// (MdmsNotificationConfigRepository.load), NOTIFICATIONS.Channel for channel
// policy (ChannelPolicyClient). Rows in the other masters decide nothing —
// EventCatalogue is seeded on every tenant, so "any NOTIFICATIONS.* row" would
// call every legacy tenant migrated, open the editor, and let the first saved
// routing row silently stop every legacy route.
//
// THE SCREENS NEVER WRITE TO THE LEGACY MASTERS. Not because the write would
// fail — an MDMS_ADMIN can still write them — but because a tenant whose
// configuration was edited in both namespaces has no single answer to "what is
// configured", and the migration's copy (which is create-only) would then
// silently keep the pre-edit values.
//
// Pure and React-free so it can be tested without the app graph.

export type NotificationSource = 'NOTIFICATIONS' | 'LEGACY' | 'NONE';

/** How many rows each master holds. Counts, not rows: the decision needs no content. */
export interface MasterCounts {
  catalogue?: number;
  routing?: number;
  template?: number;
  providerTemplate?: number;
  channel?: number;
}

export interface SourceDecision {
  source: NotificationSource;
  /** True when the screens must offer no create / edit / delete affordance. */
  readOnly: boolean;
  /** Banner headline, '' when there is nothing to say. */
  title: string;
  /** Banner body — always says what to DO, never just what is wrong. */
  message: string;
  /** 'info' for the migrated case (no banner), 'warn' otherwise. */
  level: 'none' | 'warn';
  /** Total rows found in the namespace that won. */
  rows: number;
}

function total(counts: MasterCounts | undefined): number {
  const c = counts ?? {};
  return (c.catalogue ?? 0) + (c.routing ?? 0) + (c.template ?? 0) + (c.providerTemplate ?? 0) + (c.channel ?? 0);
}

/**
 * Named in every banner so the operator does not have to find them. A deploy only upgrades
 * software. It installs the shipped defaults on a FRESH install only (no configuration and
 * no complaint ever filed); it never moves a tenant that still has legacy rows, and never
 * writes defaults into an existing tenant with no configuration — that tenant may have run
 * 2.12's hard-coded notifications, and the defaults would change what its citizens receive.
 * Both are the per-tenant migration script, one-way, after its plan has been reviewed
 * (docs/2.20/notifications/migration.md). Reused by every screen that says "move it".
 */
export const NOTIFICATION_SEED_COMMAND = './deploy.sh <tenant> --tags notifications';
export const NOTIFICATION_MIGRATE_COMMAND =
  'migrate-notifications.py plan --tenant <tenant>, then apply --tenant <tenant> --yes';
export const NOTIFICATION_ADOPT_DEFAULTS_COMMAND =
  'migrate-notifications.py plan --tenant <tenant> --adopt-defaults, then apply --tenant <tenant> --adopt-defaults --yes';

/** The master whose rows decide the namespace, as the box decides it. */
export type SwitchMaster = 'routing' | 'channel';

const SWITCH: Record<SwitchMaster, { modern: string; legacy: string; flip: string; none: string }> = {
  routing: {
    modern: 'NOTIFICATIONS.Routing',
    legacy: 'RAINMAKER-PGR.Notification*',
    flip: 'the notification service moves the whole tenant to NOTIFICATIONS.* the moment the first NOTIFICATIONS.Routing '
      + 'row exists, and every legacy route stops at once',
    none: 'an event on this tenant is recorded SKIPPED / NB_NO_ROUTING',
  },
  channel: {
    modern: 'NOTIFICATIONS.Channel',
    legacy: 'RAINMAKER-PGR.NotificationChannel',
    flip: 'the notification service moves the tenant\'s channel policy to NOTIFICATIONS.Channel the moment the first row '
      + 'exists there, and every channel without a row in it is switched off',
    none: 'the notification service falls back to the deployment-wide channel settings',
  },
};

/**
 * Decide which namespace serves this tenant — exactly as novu-bridge does.
 *
 * `modern`/`legacy` are the row counts already loaded by the screen. An
 * undefined (not-yet-loaded) master counts as zero, so call this only once the
 * lists have settled — `pending` exists for that: while it is true the decision
 * is NONE/read-only with no banner, which renders as "loading" rather than as
 * the alarming "this tenant has not been migrated".
 *
 * `switchOn` names the master the box switches on (default `routing`). Only its
 * rows can make a tenant LEGACY or NOTIFICATIONS; the other masters only tell
 * NOTIFICATIONS-but-unrouted (writable: there is nothing to flip) from NONE.
 *
 * `present` says whether that master holds ANY record at the state tenant,
 * active or not, when the caller knows: the box's routing read has no isActive
 * filter, so a tenant whose routing rows were all deleted stays on
 * NOTIFICATIONS.* and does not fall back to legacy. It can only add to the
 * (active) counts, never outvote them.
 */
export function selectNotificationSource(input: {
  modern: MasterCounts;
  legacy: MasterCounts;
  pending?: boolean;
  switchOn?: SwitchMaster;
  present?: { modern?: boolean; legacy?: boolean };
}): SourceDecision {
  const key = input.switchOn ?? 'routing';
  const names = SWITCH[key];
  const modern = total(input.modern);
  const legacy = total(input.legacy);
  // An active row is itself a record, so it counts even if a probe said otherwise
  // (a probe answered before a row was written is simply stale).
  const modernSwitched = (input.modern[key] ?? 0) > 0 || input.present?.modern === true;
  const legacySwitched = (input.legacy[key] ?? 0) > 0 || input.present?.legacy === true;

  if (input.pending) {
    return { source: 'NONE', readOnly: true, title: '', message: '', level: 'none', rows: 0 };
  }

  if (modernSwitched) {
    return {
      source: 'NOTIFICATIONS',
      readOnly: false,
      title: '',
      message: '',
      level: 'none',
      rows: modern,
    };
  }

  if (legacySwitched) {
    return {
      source: 'LEGACY',
      readOnly: true,
      title: 'This tenant has not been migrated yet — shown read-only',
      message:
        `This tenant has no ${names.modern} rows, so the notification service is still serving its old ${names.legacy} `
        + `configuration (${legacy} row${legacy === 1 ? '' : 's'}). It is shown here translated into the new vocabulary, exactly as the `
        + 'notification service reads it, so what you see is what is delivered — but it cannot be edited from here: '
        + `${names.flip}. `
        + `Move it with the migration script (${NOTIFICATION_MIGRATE_COMMAND}); it copies this tenant's own rows, is one-way, and never deletes or changes a legacy row.`,
      level: 'warn',
      rows: legacy,
    };
  }

  if (modern > 0) {
    // Nothing is routed in either namespace (the box records every event SKIPPED /
    // NB_NO_ROUTING), but the new masters are seeded: writing the first row here IS
    // how this tenant gets configured, and no legacy route can stop because of it.
    return {
      source: 'NOTIFICATIONS',
      readOnly: false,
      title: '',
      message: '',
      level: 'none',
      rows: modern,
    };
  }

  return {
    source: 'NONE',
    readOnly: true,
    title: 'No notification configuration on this tenant',
    message:
      `Neither ${names.modern} nor the old ${names.legacy} masters have any rows here, and nothing else in NOTIFICATIONS.* is seeded, `
      + `so there is nothing to show and nothing to edit — ${names.none}. `
      + `On a fresh install the deploy installs the default configuration (${NOTIFICATION_SEED_COMMAND}). `
      + 'A tenant that already has complaints does not get it from a deploy — it may have run the old built-in notifications, '
      + `and the defaults would change what its citizens receive — so review and install them with the migration script `
      + `(${NOTIFICATION_ADOPT_DEFAULTS_COMMAND}). Then reload this screen.`,
    level: 'warn',
    rows: 0,
  };
}

/** The rule id a refused namespace-flipping save is reported under. */
export const NAMESPACE_SWITCH_RULE = 'namespace-switch';

/**
 * Why a save on `resource` must be refused because it would flip the tenant's
 * namespace, or null when it would not. The box serves a LEGACY tenant for
 * exactly as long as the switch master holds no record, so the first row
 * written to it — from any screen, including the raw MDMS form — switches the
 * whole tenant. The guided screens are already read-only there; this closes
 * the raw form the same way. Refused rather than confirmed: the only safe way
 * off legacy is the migration script's copy, which moves every row at once.
 */
export function namespaceSwitchMessage(
  resource: string | undefined,
  routing: SourceDecision,
  channel: SourceDecision,
): string | null {
  const key: SwitchMaster | null =
    resource === 'notifications-routing' ? 'routing' : resource === 'notifications-channel' ? 'channel' : null;
  if (!key) return null;
  const decision = key === 'routing' ? routing : channel;
  if (decision.source !== 'LEGACY') return null;
  const names = SWITCH[key];
  return `This tenant is still served from the legacy ${names.legacy} masters, and ${names.flip}. `
    + `Saving this ${names.modern} row would do exactly that. Move the whole configuration with the migration script `
    + `(${NOTIFICATION_MIGRATE_COMMAND}) instead, then edit it here.`;
}

/** True when the screens may create, edit or delete. */
export function canWrite(decision: SourceDecision): boolean {
  return decision.source === 'NOTIFICATIONS' && !decision.readOnly;
}
