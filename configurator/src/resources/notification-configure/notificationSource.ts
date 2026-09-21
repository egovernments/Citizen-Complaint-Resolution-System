// WHICH NAMESPACE IS THIS TENANT'S CONFIGURATION IN?
//
// During the transition a tenant is in exactly one of three states, and the
// screens must behave correctly in all three:
//
//   NOTIFICATIONS  the copy has run — `NOTIFICATIONS.*` holds the configuration.
//                  Read and WRITE there. The legacy masters are read-only
//                  history.
//   LEGACY         the images are new but the seed step has not run. The
//                  `RAINMAKER-PGR.Notification*` rows are still the live
//                  configuration, and the box reads them through its own
//                  adapter. Show them, adapted, READ-ONLY, and say why.
//   NONE           neither namespace has a row. Nothing has been seeded.
//
// THE DECISION IS PER TENANT AND ALL-OR-NOTHING, NEVER PER ROW. Per-row
// precedence between two namespaces is the kind of thing nobody can reason
// about at 2am: an operator would see a screen that is half one vocabulary and
// half the other, and a row they "fixed" in the new namespace would sit behind
// a legacy row the box still preferred.
//
// THE SCREENS NEVER WRITE TO THE LEGACY MASTERS. Not because the write would
// fail — an MDMS_ADMIN can still write them — but because a tenant whose
// configuration was edited in both namespaces has no single answer to "what is
// configured", and the copy step (which is create-only) would then silently
// keep the pre-edit values.
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
 * The seed step that performs the copy. Named in every banner so the operator
 * does not have to find it: the copy is new CODE in the seeder (it reads the
 * tenant's real rows over `/mdms-v2/v2/_search`), not a data file, so re-running
 * the tag is the whole fix.
 */
export const NOTIFICATION_SEED_COMMAND = './deploy.sh <tenant> --tags notifications';

/**
 * Decide which namespace serves this tenant.
 *
 * `modern`/`legacy` are the row counts already loaded by the screen. An
 * undefined (not-yet-loaded) master counts as zero, so call this only once the
 * lists have settled — `pending` exists for that: while it is true the decision
 * is NONE/read-only with no banner, which renders as "loading" rather than as
 * the alarming "this tenant has not been migrated".
 */
export function selectNotificationSource(input: {
  modern: MasterCounts;
  legacy: MasterCounts;
  pending?: boolean;
}): SourceDecision {
  const modern = total(input.modern);
  const legacy = total(input.legacy);

  if (input.pending) {
    return { source: 'NONE', readOnly: true, title: '', message: '', level: 'none', rows: 0 };
  }

  if (modern > 0) {
    return {
      source: 'NOTIFICATIONS',
      readOnly: false,
      title: '',
      message: '',
      level: 'none',
      rows: modern,
    };
  }

  if (legacy > 0) {
    return {
      source: 'LEGACY',
      readOnly: true,
      title: 'This tenant has not been migrated yet — shown read-only',
      message:
        `Notification configuration has moved to the shared NOTIFICATIONS.* masters, and this tenant still has ${legacy} row${legacy === 1 ? '' : 's'} `
        + 'only in the old RAINMAKER-PGR.Notification* masters. They are shown here translated into the new vocabulary, exactly as the '
        + 'notification service reads them, so what you see is what is delivered — but they cannot be edited from this screen, because '
        + 'editing both namespaces leaves the tenant with two answers to "what is configured" and the copy step would keep the pre-edit values. '
        + `Re-run the notification seed step (${NOTIFICATION_SEED_COMMAND}) to copy them; it is additive and never deletes or changes a legacy row.`,
      level: 'warn',
      rows: legacy,
    };
  }

  return {
    source: 'NONE',
    readOnly: true,
    title: 'No notification configuration on this tenant',
    message:
      'Neither the NOTIFICATIONS.* masters nor the old RAINMAKER-PGR.Notification* masters have any rows here, so there is nothing to show and '
      + 'nothing to edit — an event on this tenant is recorded SKIPPED / NB_NO_ROUTING. '
      + `Run the notification seed step (${NOTIFICATION_SEED_COMMAND}) to install the default configuration, then reload this screen.`,
    level: 'warn',
    rows: 0,
  };
}

/** True when the screens may create, edit or delete. */
export function canWrite(decision: SourceDecision): boolean {
  return decision.source === 'NOTIFICATIONS' && !decision.readOnly;
}
