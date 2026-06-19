import type { RaRecord } from 'ra-core';

/** One MDMS PGR ServiceDef record (a sub-type), as normalized by the data provider. */
export interface SubTypeRecord {
  id: RaRecord['id'];
  serviceCode: string;
  name?: string;
  /** Some ServiceDefs rows carry the display name as `serviceName` instead of
   *  `name` (see api/services/mdms.ts getComplaintTypes); used as a fallback. */
  serviceName?: string;
  department?: string;
  slaHours?: number;
  menuPath?: string;
  active?: boolean;
  order?: number;
}

/** A derived Complaint Type — a group of sub-types sharing a menuPath. */
export interface ComplaintTypeGroup {
  /** Upper-cased menuPath key, or '' for the uncategorized bucket. */
  menuPath: string;
  /** Display label: localized SERVICEDEFS.<MENUPATH>, or the raw menuPath. */
  label: string;
  count: number;
  activeCount: number;
  isUncategorized: boolean;
  /** Lowest order value among sub-types; drives type ordering. */
  minOrder: number;
  subTypes: SubTypeRecord[];
}

type TranslateFn = (key: string, options?: { _?: string }) => string;

const orderOf = (r: SubTypeRecord): number =>
  typeof r.order === 'number' ? r.order : Number.POSITIVE_INFINITY;

/**
 * Group flat sub-type records into Complaint Types by menuPath.
 * Grouping is case-insensitive (Sanitation / SANITATION collapse into one).
 * Records with no menuPath fall into a single "Uncategorized" group, always
 * rendered last. Types are ordered by their minimum `order`; sub-types within a
 * type by `order` then `serviceCode`.
 */
export function groupComplaintTypes(
  records: SubTypeRecord[],
  translate: TranslateFn,
): ComplaintTypeGroup[] {
  const buckets = new Map<string, { original: string; records: SubTypeRecord[] }>();

  for (const r of records) {
    const raw = (r.menuPath ?? '').trim();
    const key = raw.toUpperCase(); // '' => uncategorized
    const existing = buckets.get(key);
    if (existing) {
      existing.records.push(r);
    } else {
      buckets.set(key, { original: raw, records: [r] });
    }
  }

  const groups: ComplaintTypeGroup[] = [];
  for (const [key, { original, records: subs }] of buckets) {
    const isUncategorized = key === '';
    const sortedSubs = [...subs].sort(
      (a, b) =>
        orderOf(a) - orderOf(b) || a.serviceCode.localeCompare(b.serviceCode),
    );
    const label = isUncategorized
      ? translate('app.complaint_types.uncategorized', { _: 'Uncategorized' })
      : translate(`SERVICEDEFS.${key}`, { _: original });
    groups.push({
      menuPath: key,
      label,
      count: subs.length,
      activeCount: subs.filter((s) => s.active === true).length,
      isUncategorized,
      minOrder: Math.min(...subs.map(orderOf)),
      subTypes: sortedSubs,
    });
  }

  groups.sort((a, b) => {
    if (a.isUncategorized !== b.isUncategorized) return a.isUncategorized ? 1 : -1;
    return a.minOrder - b.minOrder || a.label.localeCompare(b.label);
  });

  return groups;
}
