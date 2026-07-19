import { translate as t } from "../i18n/localeRuntime";
import { dimensionLabel } from "../i18n/dimensionLabel";
import { formatNumber } from "../utils/numberFormat";

const MS_PER_HOUR = 3600000;
const MS_PER_DAY = 86400000;

// Display text resolves through dimensionLabel (kinds slaState /
// workflowStatus) against DASHBOARD_SLA_* / DASHBOARD_WF_STAGE_* messages —
// no code-owned fallbacks; unseeded states surface their raw code.
const OPEN_STATUS_KEYS = new Set(["PENDINGFORASSIGNMENT", "OPEN"]);
const ASSIGNED_STATUS_KEYS = new Set(["PENDINGATLME", "ASSIGNED"]);

// The numeric part goes through the tenant mask (formatNumber, null when
// unconfigured -> the pre-#1213 expression); "+" and hr/hrs/d units stay
// here. R7: durations take the mask decimal separator — they are numbers.
export function formatBreachDurationCompact(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return null;
  const hours = n / MS_PER_HOUR;
  if (hours < 48) {
    const rounded = Math.round(hours * 10) / 10;
    const formatted =
      formatNumber(rounded, { decimals: 1, trim: true }) ??
      (Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1));
    return `+${formatted}${rounded === 1 ? t("DASHBOARD_UNIT_HR", "hr") : t("DASHBOARD_UNIT_HRS", "hrs")}`;
  }
  const days = n / MS_PER_DAY;
  const rounded = Math.round(days * 10) / 10;
  const formatted =
    formatNumber(rounded, { decimals: 1, trim: true }) ??
    (Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1));
  return `+${formatted}${t("DASHBOARD_UNIT_D", "d")}`;
}

export function resolveSlaRiskPresentation(bucket) {
  const normalized = String(bucket ?? "").toLowerCase();
  if (normalized === "approaching") {
    return {
      slaLabel: dimensionLabel("NEARING", "slaState"),
      slaLevel: "nearing",
    };
  }
  return {
    slaLabel: dimensionLabel("BREACHED", "slaState"),
    slaLevel: "breached",
  };
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
  return dimensionLabel(normalizeWorkflowStatusKey(status), "workflowStatus");
}

export function normalizeWorkflowStatusKey(status) {
  const key = String(status ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s_-]+/g, "");

  if (!key) return "in_progress";
  if (key.includes("REOPEN")) return "reopened";
  if (ASSIGNED_STATUS_KEYS.has(key) || (key.includes("ASSIGN") && !key.includes("PENDINGFORASSIGNMENT"))) {
    return "assigned";
  }
  if (OPEN_STATUS_KEYS.has(key) || key === "PENDINGFORASSIGNMENT") return "open";
  if (key.includes("INPROGRESS") || key.includes("PROGRESS")) return "in_progress";
  if (
    key.includes("PENDING") ||
    key.includes("SUPERVISOR") ||
    key.includes("REASSIGN") ||
    key.includes("ESCALAT")
  ) {
    return "in_progress";
  }
  return "in_progress";
}
