/**
 * Source channel rollups for dashboard charts and KPIs.
 * Aligns raw `source` values on complaint_facts with user-facing channel labels.
 */

export const COMPLAINT_CHANNELS = [
  {
    id: "web",
    label: "Web",
    sources: ["web", "online", "citizen"],
    color: "var(--chart-2)",
  },
  {
    id: "mobile",
    label: "Mobile",
    sources: ["app", "mobile"],
    color: "var(--chart-1)",
  },
  {
    id: "ivr",
    label: "IVR",
    sources: ["phone", "ivr"],
    color: "var(--chart-3)",
  },
  {
    id: "walk_in",
    label: "Walk-in",
    sources: ["walk_in", "walk-in", "walkin", "counter"],
    color: "var(--chart-4)",
  },
];

const SOURCE_TO_CHANNEL = new Map(
  COMPLAINT_CHANNELS.flatMap((channel) =>
    channel.sources.map((source) => [normalizeSourceKey(source), channel.id])
  )
);

export function normalizeSourceKey(source) {
  return String(source ?? "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
}

export function resolveChannelForSource(source) {
  const key = normalizeSourceKey(source);
  if (!key) return null;
  return SOURCE_TO_CHANNEL.get(key) ?? null;
}

export function formatChannelLabel(channelId) {
  const channel = COMPLAINT_CHANNELS.find((entry) => entry.id === channelId);
  return channel?.label ?? "Other";
}
