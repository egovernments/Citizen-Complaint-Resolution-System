import { VISUALIZATION_STYLES, VIZ_TYPE } from "./visualizationStyles";

export const DATA_TABLE_STYLES = VISUALIZATION_STYLES[VIZ_TYPE.DATA_TABLE];
export const SLA_RISK_TABLE_STYLES = VISUALIZATION_STYLES[VIZ_TYPE.SLA_RISK_TABLE];

export function getDataTableThClass(align = "left") {
  const { th, thRight } = DATA_TABLE_STYLES;
  return align === "right" ? `${th} ${thRight}` : th;
}

export function getDataTableTdClass(align = "left") {
  const { td, tdRight } = DATA_TABLE_STYLES;
  return align === "right" ? `${td} ${tdRight}` : td;
}

export function getSlaRiskStatusPillClass(status) {
  const { statusPill, statusPillReopened, statusPillInProgress } = SLA_RISK_TABLE_STYLES;
  if (status === "reopened") {
    return `${statusPill} ${statusPillReopened}`;
  }
  return `${statusPill} ${statusPillInProgress}`;
}
