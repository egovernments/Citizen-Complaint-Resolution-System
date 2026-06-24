const MS_PER_HOUR = 3600000;
const MS_PER_DAY = 86400000;

export const SLA_STATUS_LABELS = {
  breached: "Breached",
  approaching: "Nearing breach",
};

export function formatBreachDurationCompact(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return null;
  const hours = n / MS_PER_HOUR;
  if (hours < 48) {
    const rounded = Math.round(hours * 10) / 10;
    const formatted = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
    return `+${formatted}${rounded === 1 ? "hr" : "hrs"}`;
  }
  const days = n / MS_PER_DAY;
  const rounded = Math.round(days * 10) / 10;
  const formatted = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `+${formatted}${rounded === 1 ? "d" : "d"}`;
}

export function resolveSlaRiskPresentation(bucket) {
  const normalized = String(bucket ?? "").toLowerCase();
  if (normalized === "approaching") {
    return { slaLabel: SLA_STATUS_LABELS.approaching, slaLevel: "nearing" };
  }
  return { slaLabel: SLA_STATUS_LABELS.breached, slaLevel: "breached" };
}

export function computeBreachDurationMs(openAgeMs, slaTargetMs, slaBucket) {
  const openAge = Number(openAgeMs);
  const slaTarget = Number(slaTargetMs);
  if (!Number.isFinite(openAge) || !Number.isFinite(slaTarget)) return null;
  if (String(slaBucket).toLowerCase() !== "breached" && openAge <= slaTarget) return null;
  if (openAge <= slaTarget) return null;
  return openAge - slaTarget;
}

export function complaintDetailHref(serviceRequestId) {
  const ctx = window?.contextPath ?? "digit-ui";
  return `/${ctx}/employee/pgr/complaint/details/${encodeURIComponent(serviceRequestId)}`;
}

export function formatWorkflowStatusLabel(status) {
  return String(status ?? "—")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function normalizeWorkflowStatusKey(status) {
  const normalized = String(status ?? "").toLowerCase();
  if (normalized.includes("reopen")) return "reopened";
  if (normalized.includes("assign")) return "assigned";
  if (normalized.includes("open") || normalized.includes("pending")) return "open";
  return "in_progress";
}
