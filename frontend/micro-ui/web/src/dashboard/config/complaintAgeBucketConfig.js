/** Open-complaint age histogram buckets (days since filed). */

export const MS_PER_DAY = 86400000;

export const OPEN_COMPLAINT_AGE_BUCKETS = [
  {
    id: "0-3d",
    label: "0–3d",
    measureKey: "bucket_0_3d",
    minMs: 0,
    maxMs: 3 * MS_PER_DAY,
  },
  {
    id: "3-7d",
    label: "3–7d",
    measureKey: "bucket_3_7d",
    minMs: 3 * MS_PER_DAY,
    maxMs: 7 * MS_PER_DAY,
  },
  {
    id: "7-14d",
    label: "7–14d",
    measureKey: "bucket_7_14d",
    minMs: 7 * MS_PER_DAY,
    maxMs: 14 * MS_PER_DAY,
  },
  {
    id: "14d+",
    label: "14d+",
    measureKey: "bucket_14d_plus",
    minMs: 14 * MS_PER_DAY,
    maxMs: null,
  },
];

/** Legacy `aging_bucket` values on complaint_facts (pre four-bucket migration). */
const LEGACY_AGING_BUCKET_TO_ID = new Map([
  ["<1d", "0-3d"],
  ["1-3d", "0-3d"],
  ["0-3d", "0-3d"],
  ["3-7d", "3-7d"],
  ["7-14d", "7-14d"],
  ["14d+", "14d+"],
  [">7d", "14d+"],
]);

const CANONICAL_BUCKET_IDS = new Set(OPEN_COMPLAINT_AGE_BUCKETS.map((bucket) => bucket.id));

export function resolveOpenComplaintAgeBucketId(agingBucket) {
  const key = String(agingBucket ?? "").trim();
  if (!key) return null;
  if (CANONICAL_BUCKET_IDS.has(key)) return key;
  return LEGACY_AGING_BUCKET_TO_ID.get(key) ?? null;
}
