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
    sources: ["app", "mobile", "mobileapp", "mobile_app"],
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
    sources: ["walk_in", "walk-in", "walkin", "counter", "csc"],
    color: "var(--chart-4)",
  },
  {
    id: "sms",
    label: "SMS",
    sources: ["sms"],
    color: "var(--chart-5)",
  },
  {
    id: "email",
    label: "Email",
    sources: ["email"],
    color: "var(--chart-5)",
  },
  {
    id: "whatsapp",
    label: "WhatsApp",
    sources: ["whatsapp"],
    color: "var(--chart-1)",
  },
  {
    id: "other",
    label: "Other",
    sources: [],
    color: "var(--muted-foreground)",
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
  return SOURCE_TO_CHANNEL.get(key) ?? "other";
}

export function formatChannelLabel(channelId) {
  const channel = COMPLAINT_CHANNELS.find((entry) => entry.id === channelId);
  return channel?.label ?? "Other";
}

/** Channels shown in pie / breakdown charts (includes Other for unmapped sources). */
export const PIE_CHART_CHANNELS = COMPLAINT_CHANNELS;
