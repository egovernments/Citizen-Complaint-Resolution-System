// NOTIFICATIONS.EventCatalogue — the authoring vocabulary.
//
// A module declares its events once: the event key, the actors its producer
// sends, the placeholder tokens its producer fills, and the channels the event
// may be routed to. Everything the Configurator used to read off the PGR
// workflow (which transitions exist, which roles act on them, which tokens are
// fillable) now comes from here instead, which is what makes the notification
// screens module-neutral.
//
// Pure and React-free on purpose: the validator, the pickers and the seed tests
// all read the same helpers.
//
// WHY A MASTER AND NOT THE EVENT ITSELF (design §6.3)
//   A template has to be validated BEFORE any event of that type has ever been
//   seen. Declaring placeholders only on the wire would leave an operator
//   authoring a template for a rarely-fired event with no validation at all.

/** One actor name the producer promises to send, as the catalogue declares it. */
export interface CatalogueActor {
  name?: string;
  label?: string;
  required?: boolean;
}

/** One placeholder token the producer fills for this event. */
export interface CataloguePlaceholder {
  name?: string;
  label?: string;
  /** Free text: when this token is expected to come through blank. */
  blankWhen?: string;
}

/** One `NOTIFICATIONS.EventCatalogue` row. `x-unique` = [eventName]. */
export interface EventCatalogueRow {
  /** Owning module — a required NON-KEY column; `eventName` is globally unique. */
  module?: string;
  /** The event key. Dotted, module-prefixed. Replaces (businessService, action, toState). */
  eventName?: string;
  /** What `entityId` names on the wire, e.g. COMPLAINT. */
  entityType?: string;
  /** What the Configurator shows in a picker. */
  label?: string;
  actors?: CatalogueActor[];
  placeholders?: CataloguePlaceholder[];
  /** Channels this event may be routed to; empty/absent means "no restriction". */
  channels?: string[];
  active?: boolean | string;
}

const norm = (v: unknown) => String(v ?? '').trim().toUpperCase();

/** `active` is a boolean widget but may arrive as a string; default true. */
export function isActiveRow(value: boolean | string | undefined): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'boolean') return value;
  const n = norm(value);
  return n !== 'FALSE' && n !== '0' && n !== 'NO';
}

/** Active rows only — an inactive catalogue row is not a valid routing target. */
export function activeEvents(rows: EventCatalogueRow[] | undefined): EventCatalogueRow[] {
  return (rows ?? []).filter((r) => isActiveRow(r.active) && String(r.eventName ?? '').trim() !== '');
}

/** Active rows indexed by UPPERCASED eventName. Later rows do not clobber earlier ones. */
export function catalogueIndex(rows: EventCatalogueRow[] | undefined): Map<string, EventCatalogueRow> {
  const out = new Map<string, EventCatalogueRow>();
  for (const r of activeEvents(rows)) {
    const key = norm(r.eventName);
    if (!out.has(key)) out.set(key, r);
  }
  return out;
}

/** The catalogue row for an event name, or undefined. Case-insensitive. */
export function eventFor(
  rows: EventCatalogueRow[] | undefined | Map<string, EventCatalogueRow>,
  eventName: unknown,
): EventCatalogueRow | undefined {
  const index = rows instanceof Map ? rows : catalogueIndex(rows);
  return index.get(norm(eventName));
}

/** Distinct module values, in first-appearance order (the module picker). */
export function catalogueModules(rows: EventCatalogueRow[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of activeEvents(rows)) {
    const m = String(r.module ?? '').trim();
    if (!m || seen.has(m.toUpperCase())) continue;
    seen.add(m.toUpperCase());
    out.push(m);
  }
  return out;
}

/** The module's active events, sorted by label then eventName (the event picker). */
export function eventsForModule(rows: EventCatalogueRow[] | undefined, module: unknown): EventCatalogueRow[] {
  const want = norm(module);
  return activeEvents(rows)
    .filter((r) => !want || norm(r.module) === want)
    .sort((a, b) => eventLabel(a).localeCompare(eventLabel(b)) || String(a.eventName).localeCompare(String(b.eventName)));
}

/** Declared placeholder token names for an event, first-appearance order, deduped. */
export function placeholderNames(row: EventCatalogueRow | undefined): string[] {
  const out: string[] = [];
  for (const p of row?.placeholders ?? []) {
    const name = String(p?.name ?? '').trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/** Declared actor names for an event, first-appearance order, deduped. */
export function actorNames(row: EventCatalogueRow | undefined): string[] {
  const out: string[] = [];
  for (const a of row?.actors ?? []) {
    const name = String(a?.name ?? '').trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * Channels an event may be routed to. An absent or empty `channels` list means
 * "no restriction declared", NOT "no channel allowed" — `allowed` is undefined
 * in that case so callers can tell the two apart.
 */
export function eventChannels(row: EventCatalogueRow | undefined): string[] | undefined {
  const list = (row?.channels ?? []).map((c) => String(c ?? '').trim()).filter(Boolean);
  return list.length > 0 ? list : undefined;
}

/** What a picker shows for an event. */
export function eventLabel(row: EventCatalogueRow | undefined): string {
  const label = String(row?.label ?? '').trim();
  return label || String(row?.eventName ?? '').trim();
}
