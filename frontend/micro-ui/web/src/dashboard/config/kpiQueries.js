import {
  KPI_METRICS,
  CHART_WIDGETS,
  getSubMetricDef,
  subMetricValueKey,
} from "./supervisorMetrics";
import {
  buildKpiContextText,
  getKpiDisplayTitle,
  resolveKpiDeltaClass,
  getStatusValueClass,
  isKpiListMetric,
  parseKpiListItems,
  resolveThresholdStatus,
  statusValueToCssColor,
} from "./kpiDisplay";
import {
  getSparklineKpiQueryConfig,
  getMetricVizType,
} from "./kpiSparkline";
import { VIZ_TYPE } from "./visualizationStyles";
import {
  SLA_STACKED_SERIES,
  STATUS_STACKED_SERIES,
  RESOLUTION_DWELL_STACKED_SERIES,
  OPEN_COMPLAINT_WORKFLOW_SERIES,
  OPEN_COMPLAINT_WORKFLOW_STAGE_KEYS,
} from "./stackedBarPresentation";
import {
  formatDepartmentLabel,
  resolveDepartmentForServiceType,
} from "./complaintTypeDepartmentConfig";
import {
  PIE_CHART_CHANNELS,
  resolveChannelForSource,
} from "./complaintChannelConfig";
import {
  OPEN_COMPLAINT_AGE_BUCKETS,
  resolveOpenComplaintAgeBucketId,
} from "./complaintAgeBucketConfig";
import {
  computeBreachDurationMs,
  formatBreachDurationCompact,
  formatWorkflowStatusLabel,
  normalizeWorkflowStatusKey,
  resolveSlaRiskPresentation,
} from "./complaintsAtRiskPresentation";

export { KPI_METRICS, CHART_WIDGETS, getSubMetricDef, subMetricValueKey };

const MS_PER_DAY = 86400000;
const MS_PER_HOUR = 3600000;
const ANALYTICS_TIME_ZONE = "Africa/Nairobi";

const channelRatio = (sources) => ({
  name: "pct",
  agg: "ratio",
  numerator: { agg: "count", filter: { source: { in: sources } } },
  denominator: { agg: "count" },
});

const filedWindow = (name) => ({
  grain: "facts",
  window: { name, timeRole: "filed_at" },
  measures: [{ name: "total", agg: "count" }],
});

const resolvedWindow = (name) => ({
  grain: "facts",
  window: { name, timeRole: "resolved_at" },
  filters: { is_resolved: true },
  measures: [{ name: "total", agg: "count" }],
});

const openWindow = (name) => ({
  grain: "facts",
  window: { name, timeRole: "filed_at" },
  filters: { is_open: true },
  measures: [{ name: "total", agg: "count" }],
});

const officerTopCount = (filters, timeWindow) => ({
  grain: "facts",
  ...(timeWindow ? { window: timeWindow } : {}),
  filters,
  dimensions: ["current_assignee_uuid"],
  measures: [{ name: "total", agg: "count" }],
  sort: [{ by: "total", dir: "desc" }],
  limit: 1,
});

export const BATCH_QUERIES = {
  cl_reg_daily: filedWindow("last_1d"),
  cl_reg_weekly: filedWindow("wtd"),
  cl_reg_monthly: filedWindow("mtd"),
  cl_reg_sparkline_7d: {
    grain: "facts",
    window: { name: "last_7d", timeRole: "filed_at" },
    dimensions: ["created_date"],
    measures: [{ name: "total", agg: "count" }],
    sort: [{ by: "created_date", dir: "asc" }],
    limit: 7,
  },
  cl_new_created_count: {
    grain: "facts",
    measures: [{ name: "total", agg: "count" }],
  },
  cl_new_created_sparkline: {
    grain: "facts",
    dimensions: ["created_date"],
    measures: [{ name: "total", agg: "count" }],
    sort: [{ by: "created_date", dir: "asc" }],
    limit: 90,
  },
  cl_new_created_prior: {
    grain: "facts",
    measures: [{ name: "total", agg: "count" }],
  },
  cl_created_today_count: {
    grain: "facts",
    measures: [{ name: "total", agg: "count" }],
  },
  cl_created_yesterday_count: {
    grain: "facts",
    measures: [{ name: "total", agg: "count" }],
  },
  cl_created_today_sparkline: {
    grain: "facts",
    dimensions: ["created_date"],
    measures: [{ name: "total", agg: "count" }],
    sort: [{ by: "created_date", dir: "asc" }],
    limit: 7,
  },
  cl_resolution_rate_count: {
    grain: "facts",
    measures: [
      {
        name: "pct",
        agg: "ratio",
        numerator: { agg: "count", filter: { is_resolved: true } },
        denominator: { agg: "count" },
      },
    ],
  },
  cl_resolution_rate_prior: {
    grain: "facts",
    measures: [
      {
        name: "pct",
        agg: "ratio",
        numerator: { agg: "count", filter: { is_resolved: true } },
        denominator: { agg: "count" },
      },
    ],
  },
  cl_resolution_rate_sparkline: {
    grain: "facts",
    dimensions: ["created_date"],
    measures: [
      {
        name: "pct",
        agg: "ratio",
        numerator: { agg: "count", filter: { is_resolved: true } },
        denominator: { agg: "count" },
      },
    ],
    sort: [{ by: "created_date", dir: "asc" }],
    limit: 366,
  },
  cl_resolution_cohort_resolved_count: {
    grain: "facts",
    filters: { is_resolved: true },
    measures: [{ name: "total", agg: "count" }],
  },
  cl_resolution_cohort_resolved_prior: {
    grain: "facts",
    filters: { is_resolved: true },
    measures: [{ name: "total", agg: "count" }],
  },
  cl_oldest_open_age: {
    grain: "facts",
    filters: { is_open: true },
    measures: [{ name: "max_age_ms", agg: "max", column: "open_age_ms" }],
  },
  cl_avg_resolution_time: {
    grain: "facts",
    filters: { is_resolved: true },
    measures: [{ name: "avg_ms", agg: "avg", column: "resolution_ms" }],
  },
  cl_avg_resolution_time_prior: {
    grain: "facts",
    filters: { is_resolved: true },
    measures: [{ name: "avg_ms", agg: "avg", column: "resolution_ms" }],
  },
  cl_reopen_rate_count: {
    grain: "facts",
    filters: { is_resolved: true },
    measures: [
      {
        name: "pct",
        agg: "ratio",
        numerator: { agg: "count", filter: { is_reopened: true } },
        denominator: { agg: "count" },
      },
    ],
  },
  cl_reopen_rate_prior: {
    grain: "facts",
    filters: { is_resolved: true },
    measures: [
      {
        name: "pct",
        agg: "ratio",
        numerator: { agg: "count", filter: { is_reopened: true } },
        denominator: { agg: "count" },
      },
    ],
  },
  cl_reopen_rate_reopened_count: {
    grain: "facts",
    filters: { is_resolved: true, is_reopened: true },
    measures: [{ name: "total", agg: "count" }],
  },
  cl_reopen_rate_reopened_prior: {
    grain: "facts",
    filters: { is_resolved: true, is_reopened: true },
    measures: [{ name: "total", agg: "count" }],
  },
  cl_csat_avg: {
    grain: "facts",
    filters: { is_resolved: true, has_rating: true },
    measures: [{ name: "avg", agg: "avg", column: "rating" }],
  },
  cl_csat_avg_prior: {
    grain: "facts",
    filters: { is_resolved: true, has_rating: true },
    measures: [{ name: "avg", agg: "avg", column: "rating" }],
  },
  cl_first_assignment_rate_count: {
    grain: "facts",
    measures: [
      {
        name: "pct",
        agg: "ratio",
        numerator: {
          agg: "count",
          filter: { has_been_assigned: true, is_reassigned: false },
        },
        denominator: { agg: "count", filter: { has_been_assigned: true } },
      },
    ],
  },
  cl_first_assignment_rate_prior: {
    grain: "facts",
    measures: [
      {
        name: "pct",
        agg: "ratio",
        numerator: {
          agg: "count",
          filter: { has_been_assigned: true, is_reassigned: false },
        },
        denominator: { agg: "count", filter: { has_been_assigned: true } },
      },
    ],
  },
  cl_first_assignment_assigned_count: {
    grain: "facts",
    filters: { has_been_assigned: true },
    measures: [{ name: "total", agg: "count" }],
  },
  cl_first_assignment_assigned_prior: {
    grain: "facts",
    filters: { has_been_assigned: true },
    measures: [{ name: "total", agg: "count" }],
  },
  cl_first_assignment_first_only_count: {
    grain: "facts",
    filters: { has_been_assigned: true, is_reassigned: false },
    measures: [{ name: "total", agg: "count" }],
  },
  cl_first_assignment_first_only_prior: {
    grain: "facts",
    filters: { has_been_assigned: true, is_reassigned: false },
    measures: [{ name: "total", agg: "count" }],
  },
  cl_sla_compliance_rate_count: {
    grain: "facts",
    measures: [
      {
        name: "pct",
        agg: "ratio",
        numerator: {
          agg: "count",
          filter: { is_resolved: true, sla_breached: false },
        },
        denominator: { agg: "count" },
      },
    ],
  },
  cl_sla_compliance_rate_prior: {
    grain: "facts",
    measures: [
      {
        name: "pct",
        agg: "ratio",
        numerator: {
          agg: "count",
          filter: { is_resolved: true, sla_breached: false },
        },
        denominator: { agg: "count" },
      },
    ],
  },
  cl_sla_compliant_resolved_count: {
    grain: "facts",
    filters: { is_resolved: true, sla_breached: false },
    measures: [{ name: "total", agg: "count" }],
  },
  cl_sla_compliant_resolved_prior: {
    grain: "facts",
    filters: { is_resolved: true, sla_breached: false },
    measures: [{ name: "total", agg: "count" }],
  },
  cl_resolved_on_time_rate_count: {
    grain: "facts",
    filters: { is_resolved: true },
    measures: [
      {
        name: "pct",
        agg: "ratio",
        numerator: { agg: "count", filter: { sla_breached: false } },
        denominator: { agg: "count" },
      },
    ],
  },
  cl_resolved_on_time_rate_prior: {
    grain: "facts",
    filters: { is_resolved: true },
    measures: [
      {
        name: "pct",
        agg: "ratio",
        numerator: { agg: "count", filter: { sla_breached: false } },
        denominator: { agg: "count" },
      },
    ],
  },
  cl_resolved_on_time_rate_sparkline: {
    grain: "facts",
    filters: { is_resolved: true },
    dimensions: ["created_date"],
    measures: [
      {
        name: "pct",
        agg: "ratio",
        numerator: { agg: "count", filter: { sla_breached: false } },
        denominator: { agg: "count" },
      },
    ],
    sort: [{ by: "created_date", dir: "asc" }],
    limit: 366,
  },
  cl_resolved_on_time_compliant_count: {
    grain: "facts",
    filters: { is_resolved: true, sla_breached: false },
    measures: [{ name: "total", agg: "count" }],
  },
  cl_resolved_on_time_compliant_prior: {
    grain: "facts",
    filters: { is_resolved: true, sla_breached: false },
    measures: [{ name: "total", agg: "count" }],
  },
  cl_open_complaints_live: {
    grain: "facts",
    filters: { is_open: true },
    measures: [{ name: "total", agg: "count" }],
  },
  cl_open_complaints_sparkline: {
    grain: "daily",
    dimensions: ["snapshot_date"],
    filters: { is_open: true },
    measures: [{ name: "total", agg: "count" }],
    sort: [{ by: "snapshot_date", dir: "asc" }],
    limit: 366,
  },
  cl_open_complaints_prior: {
    grain: "daily",
    filters: { is_open: true },
    measures: [{ name: "total", agg: "count" }],
    limit: 1,
  },
  cl_resolved_date_range_count: {
    grain: "facts",
    filters: { is_resolved: true },
    measures: [{ name: "total", agg: "count" }],
  },
  cl_resolved_date_range_prior: {
    grain: "facts",
    filters: { is_resolved: true },
    measures: [{ name: "total", agg: "count" }],
  },
  cl_resolved_date_range_sparkline: {
    grain: "events",
    dimensions: ["occurred_date"],
    filters: { status: { in: ["RESOLVED", "CLOSEDAFTERRESOLUTION"] } },
    measures: [{ name: "total", agg: "count_distinct", column: "service_request_id" }],
    sort: [{ by: "occurred_date", dir: "asc" }],
    limit: 366,
  },
  cl_reg_prior_week: {
    grain: "facts",
    measures: [{ name: "total", agg: "count" }],
  },
  cl_open_daily: {
    grain: "facts",
    filters: { is_open: true },
    measures: [{ name: "total", agg: "count" }],
  },
  cl_open_weekly: openWindow("wtd"),
  cl_open_monthly: openWindow("mtd"),
  cl_open_sparkline_7d: {
    grain: "facts",
    window: { name: "last_7d", timeRole: "filed_at" },
    filters: { is_open: true },
    dimensions: ["created_date"],
    measures: [{ name: "total", agg: "count" }],
    sort: [{ by: "created_date", dir: "asc" }],
    limit: 7,
  },
  cl_open_prior_week: {
    grain: "facts",
    filters: { is_open: true },
    measures: [{ name: "total", agg: "count" }],
  },
  cl_res_daily: resolvedWindow("last_1d"),
  cl_res_weekly: resolvedWindow("wtd"),
  cl_res_monthly: resolvedWindow("mtd"),
  cl_res_sparkline_7d: {
    grain: "facts",
    window: { name: "last_7d", timeRole: "resolved_at" },
    filters: { is_resolved: true },
    dimensions: ["created_date"],
    measures: [{ name: "total", agg: "count" }],
    sort: [{ by: "created_date", dir: "asc" }],
    limit: 7,
  },
  cl_res_prior_week: {
    grain: "facts",
    filters: { is_resolved: true },
    measures: [{ name: "total", agg: "count" }],
  },
  cl_channel_app: {
    grain: "facts",
    measures: [channelRatio(["app", "mobile", "mobileapp", "mobile_app"])],
  },
  cl_channel_phone: { grain: "facts", measures: [channelRatio(["phone", "ivr"])] },
  cl_channel_walkin: {
    grain: "facts",
    measures: [channelRatio(["walk_in", "walk-in", "walkin", "counter", "csc"])],
  },
  cl_channel_online: {
    grain: "facts",
    measures: [channelRatio(["web", "online", "citizen"])],
  },
  cl_new_complainants: {
    grain: "facts",
    window: { name: "wtd", timeRole: "filed_at" },
    measures: [
      {
        name: "total",
        agg: "count",
        filter: { is_first_time_complainant: true },
      },
    ],
  },
  cl_repeat_complainants: {
    grain: "facts",
    window: { name: "wtd", timeRole: "filed_at" },
    measures: [
      {
        name: "total",
        agg: "count",
        filter: { is_first_time_complainant: false },
      },
    ],
  },
  cl_repeat_pct: {
    grain: "facts",
    window: { name: "wtd", timeRole: "filed_at" },
    measures: [
      {
        name: "pct",
        agg: "ratio",
        numerator: {
          agg: "count",
          filter: { is_first_time_complainant: false },
        },
        denominator: { agg: "count" },
      },
    ],
  },
  cl_chart_categories: {
    grain: "facts",
    window: { name: "wtd", timeRole: "filed_at" },
    dimensions: ["service_code"],
    measures: [{ name: "total", agg: "count" }],
    sort: [{ by: "total", dir: "desc" }],
    limit: 5,
  },
  cl_chart_complaints_by_type: {
    grain: "facts",
    window: { name: "wtd", timeRole: "filed_at" },
    dimensions: ["service_code"],
    measures: [{ name: "total", agg: "count" }],
    sort: [{ by: "total", dir: "desc" }],
    limit: 8,
  },
  cl_chart_departments_by_type: {
    grain: "facts",
    window: { name: "wtd", timeRole: "filed_at" },
    dimensions: ["service_code", "department_code"],
    measures: [{ name: "total", agg: "count" }],
    limit: 500,
  },
  cl_chart_department_resolution_rate: {
    grain: "facts",
    window: { name: "wtd", timeRole: "filed_at" },
    dimensions: ["service_code", "department_code"],
    measures: [
      { name: "filed", agg: "count" },
      { name: "resolved", agg: "count", filter: { is_resolved: true } },
    ],
    limit: 500,
  },
  cl_chart_wards: {
    grain: "facts",
    window: { name: "wtd", timeRole: "filed_at" },
    dimensions: ["ward_code"],
    measures: [{ name: "total", agg: "count" }],
    sort: [{ by: "total", dir: "desc" }],
    limit: 10,
  },
  cl_chart_dow: {
    grain: "facts",
    window: { name: "wtd", timeRole: "filed_at" },
    dimensions: ["created_dow"],
    measures: [{ name: "total", agg: "count" }],
    sort: [{ by: "created_dow", dir: "asc" }],
  },
  cl_chart_officer_sla: {
    grain: "facts",
    filters: { is_open: true },
    dimensions: ["current_assignee_uuid", "sla_status_bucket"],
    measures: [{ name: "total", agg: "count" }],
    limit: 120,
  },
  cl_chart_open_by_type_stage: {
    grain: "facts",
    filters: { is_open: true },
    dimensions: ["service_code", "application_status"],
    measures: [{ name: "total", agg: "count" }],
    limit: 300,
  },
  cl_chart_open_by_channel: {
    grain: "facts",
    filters: { is_open: true },
    dimensions: ["source"],
    measures: [{ name: "total", agg: "count" }],
    sort: [{ by: "total", dir: "desc" }],
    limit: 50,
  },
  cl_chart_open_by_age: {
    grain: "facts",
    filters: { is_open: true },
    dimensions: ["aging_bucket"],
    measures: [{ name: "total", agg: "count" }],
    limit: 10,
  },
  cl_map_ward_wow_current: {
    grain: "facts",
    window: { name: "last_7d", timeRole: "filed_at" },
    dimensions: ["ward_code"],
    measures: [{ name: "total", agg: "count" }],
    sort: [{ by: "total", dir: "desc" }],
    limit: 200,
  },
  cl_map_ward_wow_prior: {
    grain: "facts",
    dimensions: ["ward_code"],
    measures: [{ name: "total", agg: "count" }],
    sort: [{ by: "total", dir: "desc" }],
    limit: 200,
  },
  cl_map_ward_sla_breach: {
    grain: "facts",
    filters: { is_open: true, sla_breached: true },
    dimensions: ["ward_code"],
    measures: [{ name: "total", agg: "count" }],
    sort: [{ by: "total", dir: "desc" }],
    limit: 200,
  },
  cl_map_ward_open: {
    grain: "facts",
    filters: { is_open: true },
    dimensions: ["ward_code"],
    measures: [{ name: "total", agg: "count" }],
    sort: [{ by: "total", dir: "desc" }],
    limit: 200,
  },
  cl_map_ward_sla_buckets: {
    grain: "facts",
    filters: { is_open: true },
    dimensions: ["ward_code", "sla_status_bucket"],
    measures: [{ name: "total", agg: "count" }],
    limit: 600,
  },
  cl_map_complaint_pins: {
    grain: "facts",
    filters: { is_open: true },
    dimensions: [
      "service_request_id",
      "latitude",
      "longitude",
      "ward_code",
      "service_code",
      "application_status",
    ],
    measures: [{ name: "total", agg: "count" }],
    limit: 2000,
  },
  cl_chart_status_week: {
    grain: "facts",
    window: { name: "last_28d", timeRole: "filed_at" },
    dimensions: ["created_week_start", "application_status"],
    measures: [{ name: "total", agg: "count" }],
    sort: [{ by: "created_week_start", dir: "asc" }],
    limit: 200,
  },
  cl_chart_over_time_created_daily: {
    grain: "facts",
    window: { name: "last_7d", timeRole: "filed_at" },
    dimensions: ["created_date"],
    measures: [
      { name: "created", agg: "count" },
      { name: "resolved", agg: "count", filter: { is_resolved: true } },
      {
        name: "on_time",
        agg: "count",
        filter: { is_resolved: true, sla_breached: false },
      },
    ],
    sort: [{ by: "created_date", dir: "asc" }],
    limit: 366,
  },
  cl_chart_over_time_created_weekly: {
    grain: "facts",
    window: { name: "last_28d", timeRole: "filed_at" },
    dimensions: ["created_week_start"],
    measures: [
      { name: "created", agg: "count" },
      { name: "resolved", agg: "count", filter: { is_resolved: true } },
      {
        name: "on_time",
        agg: "count",
        filter: { is_resolved: true, sla_breached: false },
      },
    ],
    sort: [{ by: "created_week_start", dir: "asc" }],
    limit: 52,
  },
  cl_chart_over_time_created_monthly: {
    grain: "facts",
    window: { name: "last_180d", timeRole: "filed_at" },
    dimensions: ["created_month"],
    measures: [
      { name: "created", agg: "count" },
      { name: "resolved", agg: "count", filter: { is_resolved: true } },
      {
        name: "on_time",
        agg: "count",
        filter: { is_resolved: true, sla_breached: false },
      },
    ],
    sort: [{ by: "created_month", dir: "asc" }],
    limit: 24,
  },
  cl_chart_over_time_resolved_daily: {
    grain: "events",
    window: { name: "last_7d", timeRole: "event_at" },
    filters: { status: { in: ["RESOLVED", "CLOSEDAFTERRESOLUTION"] } },
    dimensions: ["occurred_date"],
    measures: [{ name: "total", agg: "count_distinct", column: "service_request_id" }],
    sort: [{ by: "occurred_date", dir: "asc" }],
    limit: 366,
  },
  cl_chart_over_time_resolved_weekly: {
    grain: "events",
    window: { name: "last_28d", timeRole: "event_at" },
    filters: { status: { in: ["RESOLVED", "CLOSEDAFTERRESOLUTION"] } },
    dimensions: ["occurred_week_start"],
    measures: [{ name: "total", agg: "count_distinct", column: "service_request_id" }],
    sort: [{ by: "occurred_week_start", dir: "asc" }],
    limit: 52,
  },
  cl_chart_over_time_resolved_monthly: {
    grain: "events",
    window: { name: "last_180d", timeRole: "event_at" },
    filters: { status: { in: ["RESOLVED", "CLOSEDAFTERRESOLUTION"] } },
    dimensions: ["occurred_month"],
    measures: [{ name: "total", agg: "count_distinct", column: "service_request_id" }],
    sort: [{ by: "occurred_month", dir: "asc" }],
    limit: 24,
  },
  cl_chart_categories_pw: {
    grain: "facts",
    dimensions: ["service_code"],
    measures: [{ name: "total", agg: "count" }],
    sort: [{ by: "total", dir: "desc" }],
    limit: 200,
  },
  cl_trending_wow: {
    grain: "facts",
    window: { name: "last_28d", timeRole: "filed_at" },
    dimensions: ["service_code", "created_week_start"],
    measures: [{ name: "total", agg: "count" }],
    limit: 500,
  },
  cl_ward_open: {
    grain: "facts",
    dimensions: ["ward_code"],
    filters: { is_open: true },
    measures: [{ name: "total", agg: "count" }],
    sort: [{ by: "total", dir: "desc" }],
    limit: 15,
  },
  cl_ward_ontime: {
    grain: "facts",
    window: { name: "wtd", timeRole: "resolved_at" },
    dimensions: ["ward_code"],
    filters: { is_resolved: true },
    measures: [
      {
        name: "ontime_pct",
        agg: "ratio",
        numerator: { agg: "count", filter: { sla_breached: false } },
        denominator: { agg: "count" },
      },
    ],
    sort: [{ by: "ontime_pct", dir: "desc" }],
    limit: 15,
  },
  rs_table_resolution_by_category: {
    grain: "facts",
    window: { name: "wtd", timeRole: "filed_at" },
    dimensions: ["service_code"],
    measures: [
      {
        name: "closure_pct",
        agg: "ratio",
        numerator: { agg: "count", filter: { is_resolved: true } },
        denominator: { agg: "count" },
      },
      {
        name: "ontime_pct",
        agg: "ratio",
        numerator: { agg: "count", filter: { is_resolved: true, sla_breached: false } },
        denominator: { agg: "count", filter: { is_resolved: true } },
      },
      {
        name: "avg_ttr_ms",
        agg: "avg",
        column: "resolution_ms",
        filter: { is_resolved: true },
      },
    ],
    sort: [{ by: "closure_pct", dir: "desc" }],
    limit: 15,
  },
  cl_table_complaint_type_details: {
    grain: "facts",
    window: { name: "wtd", timeRole: "filed_at" },
    dimensions: ["service_code", "service_group"],
    measures: [
      {
        name: "avg_resolution_ms",
        agg: "avg",
        column: "resolution_ms",
        filter: { is_resolved: true },
      },
      { name: "ideal_sla_ms", agg: "avg", column: "sla_target_ms" },
      {
        name: "reopen_rate",
        agg: "ratio",
        numerator: { agg: "count", filter: { is_reopened: true } },
        denominator: { agg: "count", filter: { is_resolved: true } },
      },
      {
        name: "oldest_open_ms",
        agg: "max",
        column: "open_age_ms",
        filter: { is_open: true },
      },
      {
        name: "ontime_rate",
        agg: "ratio",
        numerator: { agg: "count", filter: { is_resolved: true, sla_breached: false } },
        denominator: { agg: "count", filter: { is_resolved: true } },
      },
      {
        name: "avg_csat",
        agg: "avg",
        column: "rating",
        filter: { is_resolved: true, has_rating: true },
      },
    ],
    sort: [{ by: "avg_resolution_ms", dir: "desc" }],
    limit: 30,
  },
  cl_table_complaints_at_risk: {
    grain: "facts",
    filters: {
      is_open: true,
      sla_status_bucket: { in: ["approaching", "breached"] },
    },
    dimensions: [
      "service_request_id",
      "service_code",
      "service_group",
      "ward_code",
      "application_status",
      "sla_status_bucket",
      "current_assignee_uuid",
    ],
    measures: [
      { name: "open_age_ms", agg: "max", column: "open_age_ms" },
      { name: "sla_target_ms", agg: "max", column: "sla_target_ms" },
    ],
    limit: 50,
  },
  ev_table_stage_dwell: {
    grain: "events",
    dimensions: ["status"],
    filters: { is_current_state: false },
    measures: [
      { name: "avg_dwell", agg: "avg", column: "dwell_ms" },
      { name: "median_dwell", agg: "percentile", column: "dwell_ms", p: 50 },
      { name: "samples", agg: "count" },
    ],
    sort: [{ by: "avg_dwell", dir: "desc" }],
    limit: 8,
  },
  ev_chart_resolution_dwell_subtype: {
    grain: "events",
    dimensions: ["service_code", "status"],
    filters: { is_current_state: false },
    measures: [{ name: "avg_dwell", agg: "avg", column: "dwell_ms" }],
    limit: 200,
  },
  // Employee performance
  ep_open_by_officer: officerTopCount({ is_open: true }),
  ep_open_list: {
    grain: "facts",
    filters: { is_open: true },
    dimensions: ["current_assignee_uuid"],
    measures: [{ name: "total", agg: "count" }],
    sort: [{ by: "total", dir: "desc" }],
    limit: 5,
  },
  ep_ttr_avg: {
    grain: "facts",
    window: { name: "wtd", timeRole: "resolved_at" },
    filters: { is_resolved: true },
    measures: [{ name: "avg_ms", agg: "avg", column: "resolution_ms" }],
  },
  ep_ttr_median: {
    grain: "facts",
    window: { name: "wtd", timeRole: "resolved_at" },
    filters: { is_resolved: true },
    measures: [{ name: "median_ms", agg: "percentile", column: "resolution_ms", p: 50 }],
  },
  ep_closed_by_officer: officerTopCount(
    { is_resolved: true },
    { name: "wtd", timeRole: "resolved_at" }
  ),
  ep_closed_list: {
    grain: "facts",
    window: { name: "wtd", timeRole: "resolved_at" },
    filters: { is_resolved: true },
    dimensions: ["current_assignee_uuid"],
    measures: [{ name: "total", agg: "count" }],
    sort: [{ by: "total", dir: "desc" }],
    limit: 5,
  },
  ep_leaderboard_closed: {
    grain: "facts",
    window: { name: "wtd", timeRole: "resolved_at" },
    filters: { is_resolved: true },
    dimensions: ["current_assignee_uuid"],
    measures: [{ name: "total", agg: "count" }],
    sort: [{ by: "total", dir: "desc" }],
    limit: 5,
  },
  ep_table_employee_performance: {
    grain: "facts",
    dimensions: ["current_assignee_uuid"],
    measures: [
      { name: "assigned", agg: "count" },
      { name: "open", agg: "count", filter: { is_open: true } },
      { name: "resolved", agg: "count", filter: { is_resolved: true } },
      {
        name: "reopen_rate",
        agg: "ratio",
        numerator: { agg: "count", filter: { is_reopened: true, is_resolved: true } },
        denominator: { agg: "count", filter: { is_resolved: true } },
      },
      {
        name: "avg_csat",
        agg: "avg",
        column: "rating",
        filter: { is_resolved: true, has_rating: true },
      },
    ],
    sort: [{ by: "open", dir: "desc" }, { by: "assigned", dir: "desc" }],
    limit: 40,
  },
  ep_table_employee_performance_dept: {
    grain: "facts",
    dimensions: ["current_assignee_uuid", "department_code"],
    measures: [{ name: "total", agg: "count" }],
    limit: 400,
  },
  ep_table_employee_performance_escalations: {
    grain: "events",
    dimensions: ["assignee_uuid"],
    filters: { is_escalation: true },
    measures: [{ name: "escalated", agg: "count_distinct", column: "service_request_id" }],
    sort: [{ by: "escalated", dir: "desc" }],
    limit: 80,
  },
  ep_reopen_7d: {
    grain: "facts",
    window: { name: "last_7d", timeRole: "resolved_at" },
    filters: { is_resolved: true },
    measures: [
      {
        name: "pct",
        agg: "ratio",
        numerator: { agg: "count", filter: { is_reopened: true } },
        denominator: { agg: "count" },
      },
    ],
  },
  ep_reopen_30d: {
    grain: "facts",
    window: { name: "last_30d", timeRole: "resolved_at" },
    filters: { is_resolved: true },
    measures: [
      {
        name: "pct",
        agg: "ratio",
        numerator: { agg: "count", filter: { is_reopened: true } },
        denominator: { agg: "count" },
      },
    ],
  },
  // Resolution & SLA
  rs_sla_compliance_week: {
    grain: "facts",
    window: { name: "wtd", timeRole: "resolved_at" },
    filters: { is_resolved: true },
    measures: [
      {
        name: "pct",
        agg: "ratio",
        numerator: { agg: "count", filter: { sla_breached: false } },
        denominator: { agg: "count" },
      },
    ],
  },
  rs_sla_compliance_sparkline_7d: {
    grain: "facts",
    window: { name: "last_7d", timeRole: "resolved_at" },
    filters: { is_resolved: true },
    dimensions: ["created_date"],
    measures: [
      {
        name: "pct",
        agg: "ratio",
        numerator: { agg: "count", filter: { sla_breached: false } },
        denominator: { agg: "count" },
      },
    ],
    sort: [{ by: "created_date", dir: "asc" }],
    limit: 7,
  },
  rs_sla_compliance_prior_week: {
    grain: "facts",
    filters: { is_resolved: true },
    measures: [
      {
        name: "pct",
        agg: "ratio",
        numerator: { agg: "count", filter: { sla_breached: false } },
        denominator: { agg: "count" },
      },
    ],
  },
  rs_breach_total: {
    grain: "facts",
    filters: { is_open: true, sla_breached: true },
    measures: [{ name: "total", agg: "count" }],
  },
  rs_breach_sparkline_7d: {
    grain: "facts",
    window: { name: "last_7d", timeRole: "filed_at" },
    filters: { is_open: true, sla_breached: true },
    dimensions: ["created_date"],
    measures: [{ name: "total", agg: "count" }],
    sort: [{ by: "created_date", dir: "asc" }],
    limit: 7,
  },
  rs_breach_prior_week: {
    grain: "facts",
    filters: { is_open: true, sla_breached: true },
    measures: [{ name: "total", agg: "count" }],
  },
  rs_zone_ttr_avg: {
    grain: "facts",
    window: { name: "wtd", timeRole: "resolved_at" },
    filters: { is_resolved: true },
    measures: [{ name: "avg_ms", agg: "avg", column: "resolution_ms" }],
  },
  rs_zone_ttr_median: {
    grain: "facts",
    window: { name: "wtd", timeRole: "resolved_at" },
    filters: { is_resolved: true },
    measures: [{ name: "median_ms", agg: "percentile", column: "resolution_ms", p: 50 }],
  },
  rs_closure_rate: {
    grain: "facts",
    measures: [
      {
        name: "pct",
        agg: "ratio",
        numerator: { agg: "count", filter: { is_resolved: true } },
        denominator: { agg: "count" },
      },
    ],
  },
  rs_inflow_daily: filedWindow("last_1d"),
  rs_outflow_daily: resolvedWindow("last_1d"),
  // Escalations & risk
  er_aging_safe: {
    grain: "facts",
    filters: { is_open: true },
    measures: [
      {
        name: "pct",
        agg: "ratio",
        numerator: { agg: "count", filter: { sla_status_bucket: "within" } },
        denominator: { agg: "count" },
      },
    ],
  },
  er_aging_approaching: {
    grain: "facts",
    filters: { is_open: true },
    measures: [
      {
        name: "pct",
        agg: "ratio",
        numerator: { agg: "count", filter: { sla_status_bucket: "approaching" } },
        denominator: { agg: "count" },
      },
    ],
  },
  er_aging_breached: {
    grain: "facts",
    filters: { is_open: true },
    measures: [
      {
        name: "pct",
        agg: "ratio",
        numerator: { agg: "count", filter: { sla_breached: true } },
        denominator: { agg: "count" },
      },
    ],
  },
  er_aging_critical: {
    grain: "facts",
    filters: { is_open: true },
    measures: [
      {
        name: "pct",
        agg: "ratio",
        numerator: { agg: "count", filter: { aging_bucket: { in: [">7d", "7-14d", "14d+"] } } },
        denominator: { agg: "count" },
      },
    ],
  },
  er_overnight_escalations: {
    grain: "events",
    window: { name: "last_1d", timeRole: "event_at" },
    filters: { is_escalation: true },
    measures: [{ name: "total", agg: "count" }],
  },
  er_overnight_auto_pct: {
    grain: "events",
    window: { name: "last_1d", timeRole: "event_at" },
    filters: { is_escalation: true },
    measures: [
      {
        name: "pct",
        agg: "ratio",
        numerator: { agg: "count", filter: { escalation_source: "auto" } },
        denominator: { agg: "count" },
      },
    ],
  },
  er_overnight_manual_pct: {
    grain: "events",
    window: { name: "last_1d", timeRole: "event_at" },
    filters: { is_escalation: true },
    measures: [
      {
        name: "pct",
        agg: "ratio",
        numerator: { agg: "count", filter: { escalation_source: "manual" } },
        denominator: { agg: "count" },
      },
    ],
  },
  er_critical_breach: {
    grain: "facts",
    filters: { is_open: true, aging_bucket: { in: [">7d", "7-14d", "14d+"] } },
    measures: [{ name: "total", agg: "count" }],
  },
  er_critical_by_officer: officerTopCount({
    is_open: true,
    aging_bucket: { in: [">7d", "7-14d", "14d+"] },
  }),
  er_escalation_auto_pct: {
    grain: "events",
    window: { name: "wtd", timeRole: "event_at" },
    filters: { is_escalation: true },
    measures: [
      {
        name: "pct",
        agg: "ratio",
        numerator: { agg: "count", filter: { escalation_source: "auto" } },
        denominator: { agg: "count" },
      },
    ],
  },
  er_escalation_manual_pct: {
    grain: "events",
    window: { name: "wtd", timeRole: "event_at" },
    filters: { is_escalation: true },
    measures: [
      {
        name: "pct",
        agg: "ratio",
        numerator: { agg: "count", filter: { escalation_source: "manual" } },
        denominator: { agg: "count" },
      },
    ],
  },
  // Citizen experience
  ce_csat_avg_week: {
    grain: "facts",
    window: { name: "wtd", timeRole: "resolved_at" },
    filters: { is_resolved: true, has_rating: true },
    measures: [{ name: "avg", agg: "avg", column: "rating" }],
  },
  ce_csat_sparkline_7d: {
    grain: "facts",
    window: { name: "last_7d", timeRole: "resolved_at" },
    filters: { is_resolved: true, has_rating: true },
    dimensions: ["created_date"],
    measures: [{ name: "avg", agg: "avg", column: "rating" }],
    sort: [{ by: "created_date", dir: "asc" }],
    limit: 7,
  },
  ce_csat_prior_week: {
    grain: "facts",
    filters: { is_resolved: true, has_rating: true },
    measures: [{ name: "avg", agg: "avg", column: "rating" }],
  },
  ce_response_rate: {
    grain: "facts",
    window: { name: "wtd", timeRole: "resolved_at" },
    filters: { is_resolved: true },
    measures: [
      {
        name: "pct",
        agg: "ratio",
        numerator: { agg: "count", filter: { has_rating: true } },
        denominator: { agg: "count" },
      },
    ],
  },
  ce_reopen_7d: {
    grain: "facts",
    window: { name: "last_7d", timeRole: "resolved_at" },
    filters: { is_resolved: true },
    measures: [
      {
        name: "pct",
        agg: "ratio",
        numerator: { agg: "count", filter: { is_reopened: true } },
        denominator: { agg: "count" },
      },
    ],
  },
  ce_reopen_sparkline_7d: {
    grain: "facts",
    window: { name: "last_7d", timeRole: "resolved_at" },
    filters: { is_resolved: true },
    dimensions: ["created_date"],
    measures: [
      {
        name: "pct",
        agg: "ratio",
        numerator: { agg: "count", filter: { is_reopened: true } },
        denominator: { agg: "count" },
      },
    ],
    sort: [{ by: "created_date", dir: "asc" }],
    limit: 7,
  },
  ce_reopen_prior_week: {
    grain: "facts",
    filters: { is_resolved: true },
    measures: [
      {
        name: "pct",
        agg: "ratio",
        numerator: { agg: "count", filter: { is_reopened: true } },
        denominator: { agg: "count" },
      },
    ],
  },
  ce_reopen_30d: {
    grain: "facts",
    window: { name: "last_30d", timeRole: "resolved_at" },
    filters: { is_resolved: true },
    measures: [
      {
        name: "pct",
        agg: "ratio",
        numerator: { agg: "count", filter: { is_reopened: true } },
        denominator: { agg: "count" },
      },
    ],
  },
  ce_repeat_complainants: {
    grain: "facts",
    window: { name: "last_30d", timeRole: "filed_at" },
    filters: { is_first_time_complainant: false },
    measures: [{ name: "total", agg: "count_distinct", column: "account_id" }],
  },
  ce_top_complainants: {
    grain: "facts",
    window: { name: "last_30d", timeRole: "filed_at" },
    dimensions: ["account_id"],
    measures: [{ name: "total", agg: "count" }],
    sort: [{ by: "total", dir: "desc" }],
    limit: 5,
  },
  ce_negative_rate: {
    grain: "facts",
    window: { name: "wtd", timeRole: "resolved_at" },
    filters: { is_resolved: true, has_rating: true },
    measures: [
      {
        name: "pct",
        agg: "ratio",
        numerator: { agg: "count", filter: { is_negative_rating: true } },
        denominator: { agg: "count" },
      },
    ],
  },
  ce_tfr_avg: {
    grain: "facts",
    window: { name: "wtd", timeRole: "filed_at" },
    measures: [{ name: "avg_ms", agg: "avg", column: "time_to_assign_ms" }],
  },
  ce_tfr_median: {
    grain: "facts",
    window: { name: "wtd", timeRole: "filed_at" },
    measures: [{ name: "median_ms", agg: "percentile", column: "time_to_assign_ms", p: 50 }],
  },
};

/** Unfiltered ward/service lists for global filter dropdowns (no self-dimension filter). */
export const FILTER_DIMENSION_QUERIES = {
  cl_filter_wards: {
    grain: "facts",
    window: { name: "wtd", timeRole: "filed_at" },
    dimensions: ["ward_code"],
    measures: [{ name: "total", agg: "count" }],
    sort: [{ by: "ward_code", dir: "asc" }],
    limit: 200,
  },
  cl_filter_categories: {
    grain: "facts",
    window: { name: "wtd", timeRole: "filed_at" },
    dimensions: ["service_code"],
    measures: [{ name: "total", agg: "count" }],
    sort: [{ by: "service_code", dir: "asc" }],
    limit: 200,
  },
};

function isoDateToStartMs(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function isoDateToEndExclusiveMs(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d + 1);
}

function mergeQueryFilters(existingFilters, globalFilters) {
  const merged = { ...(existingFilters || {}) };
  for (const [key, value] of Object.entries(globalFilters)) {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      merged[key] = { ...(merged[key] || {}), ...value };
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function dateFilterColumnForQuery(query) {
  // The events grain has no created_at/resolved_at; complaint_created_at filters events
  // by the same complaint population as the facts widgets.
  if (query.grain === "events") {
    return "complaint_created_at";
  }
  if (query.grain === "daily") {
    return "snapshot_date";
  }
  if (query.window?.timeRole === "resolved_at") {
    return "resolved_at";
  }
  return "created_at";
}

function snapshotDateRangeFilter(bounds) {
  return {
    gte: isoDateFromUtcMs(bounds.fromMs),
    lt: isoDateFromUtcMs(bounds.toMs),
  };
}

function priorPeriodEndDateIso(bounds, dateFrom) {
  if (dateFrom) {
    return isoDateFromUtcMs(isoDateToStartMs(dateFrom) - MS_PER_DAY);
  }
  return isoDateFromUtcMs(bounds.fromMs - MS_PER_DAY);
}

export function buildGlobalApiFilters(dashboardFilters) {
  const apiFilters = {};

  if (dashboardFilters?.geography && dashboardFilters.geography !== "all") {
    apiFilters.ward_code = dashboardFilters.geography;
  }
  if (dashboardFilters?.complaintType && dashboardFilters.complaintType !== "all") {
    apiFilters.service_code = dashboardFilters.complaintType;
  }

  if (
    dashboardFilters?.dateRangeActive &&
    dashboardFilters?.dateFrom &&
    dashboardFilters?.dateTo
  ) {
    apiFilters.__dateRange = {
      fromMs: isoDateToStartMs(dashboardFilters.dateFrom),
      toMs: isoDateToEndExclusiveMs(dashboardFilters.dateTo),
    };
  }

  return apiFilters;
}

function applyDashboardFiltersToQuery(query, apiFilters) {
  if (!apiFilters || Object.keys(apiFilters).length === 0) {
    return query;
  }

  const { __dateRange, ...dimensionFilters } = apiFilters;
  const next = { ...query };
  const filtersToApply = { ...dimensionFilters };

  if (__dateRange) {
    const dateColumn = dateFilterColumnForQuery(query);
    filtersToApply[dateColumn] =
      query.grain === "daily" && dateColumn === "snapshot_date"
        ? snapshotDateRangeFilter(__dateRange)
        : { gte: __dateRange.fromMs, lt: __dateRange.toMs };
    delete next.window;
  }

  if (Object.keys(filtersToApply).length === 0) {
    return query;
  }

  next.filters = mergeQueryFilters(query.filters, filtersToApply);
  return next;
}

function priorWeekCreatedAtFilter() {
  const now = new Date();
  const day = now.getDay();
  const daysFromMonday = day === 0 ? 6 : day - 1;
  const thisMonday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - daysFromMonday
  );
  thisMonday.setHours(0, 0, 0, 0);
  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(lastMonday.getDate() - 7);
  return { gte: lastMonday.getTime(), lt: thisMonday.getTime() };
}

const DATE_RANGE_KPI_QUERY_KEYS = new Set([
  "cl_new_created_count",
  "cl_new_created_sparkline",
  "cl_new_created_prior",
  "cl_open_complaints_sparkline",
  "cl_open_complaints_prior",
  "cl_resolved_date_range_count",
  "cl_resolved_date_range_prior",
  "cl_resolved_date_range_sparkline",
  "cl_resolution_rate_count",
  "cl_resolution_rate_prior",
  "cl_resolution_rate_sparkline",
  "cl_resolution_cohort_resolved_count",
  "cl_resolution_cohort_resolved_prior",
  "cl_avg_resolution_time",
  "cl_avg_resolution_time_prior",
  "cl_reopen_rate_count",
  "cl_reopen_rate_prior",
  "cl_reopen_rate_reopened_count",
  "cl_reopen_rate_reopened_prior",
  "cl_csat_avg",
  "cl_csat_avg_prior",
  "cl_first_assignment_rate_count",
  "cl_first_assignment_rate_prior",
  "cl_first_assignment_assigned_count",
  "cl_first_assignment_assigned_prior",
  "cl_first_assignment_first_only_count",
  "cl_first_assignment_first_only_prior",
  "cl_sla_compliance_rate_count",
  "cl_sla_compliance_rate_prior",
  "cl_sla_compliant_resolved_count",
  "cl_sla_compliant_resolved_prior",
  "cl_resolved_on_time_rate_count",
  "cl_resolved_on_time_rate_prior",
  "cl_resolved_on_time_rate_sparkline",
  "cl_resolved_on_time_compliant_count",
  "cl_resolved_on_time_compliant_prior",
]);

function selectedDateRangeBounds(dashboardFilters, apiFilters) {
  if (apiFilters?.__dateRange) {
    return apiFilters.__dateRange;
  }
  if (dashboardFilters?.dateFrom && dashboardFilters?.dateTo) {
    return {
      fromMs: isoDateToStartMs(dashboardFilters.dateFrom),
      toMs: isoDateToEndExclusiveMs(dashboardFilters.dateTo),
    };
  }
  return null;
}

function countDaysInDateRange(bounds) {
  const durationMs = bounds.toMs - bounds.fromMs;
  return Math.max(1, Math.ceil(durationMs / MS_PER_DAY));
}

function isoDateFromUtcMs(ms) {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function eatDateKeyFromEpochMs(ms) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ANALYTICS_TIME_ZONE }).format(
    new Date(ms)
  );
}

function todayEatIso() {
  return eatDateKeyFromEpochMs(Date.now());
}

function eatDayStartMs(isoDate) {
  return new Date(`${isoDate}T00:00:00+03:00`).getTime();
}

function shiftEatIsoDate(isoDate, dayDelta) {
  return eatDateKeyFromEpochMs(eatDayStartMs(isoDate) + dayDelta * MS_PER_DAY);
}

function todayEatBounds() {
  const todayIso = todayEatIso();
  return { fromMs: eatDayStartMs(todayIso), toMs: Date.now() };
}

function yesterdayEatBounds() {
  const todayIso = todayEatIso();
  const yesterdayIso = shiftEatIsoDate(todayIso, -1);
  return { fromMs: eatDayStartMs(yesterdayIso), toMs: eatDayStartMs(todayIso) };
}

function recentEatDayBounds(dayCount) {
  const todayIso = todayEatIso();
  const startIso = shiftEatIsoDate(todayIso, -(dayCount - 1));
  return { fromMs: eatDayStartMs(startIso), toMs: Date.now() };
}

function eatRecentDaysDashboardFilters(dayCount) {
  const todayIso = todayEatIso();
  return {
    dateFrom: shiftEatIsoDate(todayIso, -(dayCount - 1)),
    dateTo: todayIso,
  };
}

function normalizeCreatedDateKey(value) {
  if (value == null || value === "") return "";

  if (Array.isArray(value) && value.length >= 3) {
    const [y, m, d] = value;
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  if (typeof value === "object") {
    if (value.year != null && value.month != null && value.day != null) {
      return `${value.year}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`;
    }
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return eatDateKeyFromEpochMs(value);
  }

  const str = String(value).trim();
  if (/^\d{13}$/.test(str)) return eatDateKeyFromEpochMs(Number(str));
  if (/^\d{10}$/.test(str)) return eatDateKeyFromEpochMs(Number(str) * 1000);
  if (/^\d+$/.test(str)) return eatDateKeyFromEpochMs(Number(str));

  const isoMatch = str.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];

  return str.slice(0, 10);
}

function eachCalendarDayInRange(dateFrom, dateTo) {
  if (!dateFrom || !dateTo) return [];
  const days = [];
  let curMs = isoDateToStartMs(dateFrom);
  const endMs = isoDateToStartMs(dateTo);
  while (curMs <= endMs) {
    days.push(isoDateFromUtcMs(curMs));
    curMs += MS_PER_DAY;
  }
  return days;
}

export function getSelectedDateRangeBounds(dashboardFilters) {
  const apiFilters = buildGlobalApiFilters(dashboardFilters);
  return selectedDateRangeBounds(dashboardFilters, apiFilters);
}

function priorPeriodCreatedAtFilter(bounds) {
  const duration = bounds.toMs - bounds.fromMs;
  return { gte: bounds.fromMs - duration, lt: bounds.fromMs };
}

/** Complaints filed in the 7 days immediately before the rolling last-7d window. */
function priorRolling7dCreatedAtFilter() {
  const now = Date.now();
  return { gte: now - 14 * MS_PER_DAY, lt: now - 7 * MS_PER_DAY };
}

function applyMapWowQueries(queries, dashboardFilters, apiFilters, dateRangeBounds) {
  const currentKey = "cl_map_ward_wow_current";
  const priorKey = "cl_map_ward_wow_prior";
  const baseCurrent = BATCH_QUERIES[currentKey];
  const basePrior = BATCH_QUERIES[priorKey];
  if (!baseCurrent || !basePrior) return;

  const { __dateRange, ...dimensionFilters } = apiFilters || {};

  if (dashboardFilters?.dateRangeActive && dateRangeBounds) {
    queries[currentKey] = applySelectedDateRangeToQuery(
      { ...baseCurrent },
      dashboardFilters,
      apiFilters
    );
    const priorFilters = { ...(basePrior.filters || {}) };
    delete priorFilters.created_at;
    queries[priorKey] = {
      ...basePrior,
      filters: mergeQueryFilters(priorFilters, {
        ...dimensionFilters,
        created_at: priorPeriodCreatedAtFilter(dateRangeBounds),
      }),
    };
    delete queries[priorKey].window;
    return;
  }

  queries[currentKey] = applyDashboardFiltersToQuery({ ...baseCurrent }, dimensionFilters);
  const priorFilters = { ...(basePrior.filters || {}) };
  delete priorFilters.created_at;
  queries[priorKey] = {
    ...basePrior,
    filters: mergeQueryFilters(priorFilters, {
      ...dimensionFilters,
      created_at: priorRolling7dCreatedAtFilter(),
    }),
  };
  delete queries[priorKey].window;
}

function applySelectedDateRangeToQuery(query, dashboardFilters, apiFilters) {
  const bounds = selectedDateRangeBounds(dashboardFilters, apiFilters);
  if (!bounds) return query;

  const { __dateRange, ...dimensionFilters } = apiFilters || {};
  const next = { ...query };
  delete next.window;
  const dateFilter =
    query.grain === "daily"
      ? { snapshot_date: snapshotDateRangeFilter(bounds) }
      : { created_at: { gte: bounds.fromMs, lt: bounds.toMs } };
  next.filters = mergeQueryFilters(mergeQueryFilters(next.filters, dimensionFilters), dateFilter);
  return next;
}

function applyResolvedAtDateRangeToQuery(query, dashboardFilters, apiFilters) {
  const bounds = selectedDateRangeBounds(dashboardFilters, apiFilters);
  if (!bounds) return query;

  const { __dateRange, ...dimensionFilters } = apiFilters || {};
  const baseFilters = { ...(query.filters || {}) };
  delete baseFilters.created_at;
  const next = { ...query };
  delete next.window;
  next.filters = mergeQueryFilters(baseFilters, {
    ...dimensionFilters,
    resolved_at: { gte: bounds.fromMs, lt: bounds.toMs },
  });
  return next;
}

function applyEnteredAtDateRangeToQuery(query, dashboardFilters, apiFilters) {
  const bounds = selectedDateRangeBounds(dashboardFilters, apiFilters);
  if (!bounds) return query;

  const { __dateRange, ...dimensionFilters } = apiFilters || {};
  const baseFilters = { ...(query.filters || {}) };
  delete baseFilters.complaint_created_at;
  delete baseFilters.created_at;
  const next = { ...query };
  delete next.window;
  next.filters = mergeQueryFilters(baseFilters, {
    ...dimensionFilters,
    entered_at: { gte: bounds.fromMs, lt: bounds.toMs },
  });
  return next;
}

function applyCreatedAtBoundsToQuery(query, bounds, dimensionFilters) {
  const baseFilters = { ...(query.filters || {}) };
  delete baseFilters.created_at;
  const next = { ...query };
  delete next.window;
  next.filters = mergeQueryFilters(baseFilters, {
    ...dimensionFilters,
    created_at: { gte: bounds.fromMs, lt: bounds.toMs },
  });
  return next;
}

function applyTodayKpiQueries(queries, apiFilters) {
  const { __dateRange, ...dimensionFilters } = apiFilters || {};

  if (queries.cl_created_today_count) {
    queries.cl_created_today_count = applyCreatedAtBoundsToQuery(
      queries.cl_created_today_count,
      todayEatBounds(),
      dimensionFilters
    );
  }
  if (queries.cl_created_yesterday_count) {
    queries.cl_created_yesterday_count = applyCreatedAtBoundsToQuery(
      queries.cl_created_yesterday_count,
      yesterdayEatBounds(),
      dimensionFilters
    );
  }
  if (queries.cl_created_today_sparkline) {
    queries.cl_created_today_sparkline = {
      ...applyCreatedAtBoundsToQuery(
        queries.cl_created_today_sparkline,
        recentEatDayBounds(7),
        dimensionFilters
      ),
      limit: 7,
    };
  }
}

function isAnalyticsResult(result) {
  return Boolean(result?.rows) && !result?.error;
}

function normalizeWeekKey(value) {
  if (value == null) return "";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return String(value).slice(0, 10);
}

function buildPriorVolumeByKey(priorResult, wowFallbackResult, labelKey = "service_code") {
  if (isAnalyticsResult(priorResult) && priorResult.rows.length > 0) {
    return Object.fromEntries(
      priorResult.rows.map((row) => [
        String(row[labelKey]),
        Number(row.total) || 0,
      ])
    );
  }

  if (!isAnalyticsResult(wowFallbackResult)) return {};

  const byWeek = new Map();
  for (const row of wowFallbackResult.rows) {
    const week = normalizeWeekKey(row.created_week_start);
    const key = String(row[labelKey]);
    if (!week || !key) continue;
    if (!byWeek.has(week)) byWeek.set(week, {});
    const bucket = byWeek.get(week);
    bucket[key] = (bucket[key] ?? 0) + (Number(row.total) || 0);
  }

  const weeks = [...byWeek.keys()].sort();
  if (weeks.length < 2) return {};
  return byWeek.get(weeks[weeks.length - 2]) || {};
}

function normalizeStageDwellQuery(query, apiFilters) {
  const baseFilters = mergeQueryFilters(query.filters, { is_current_state: false });
  const { __dateRange, ...dimensionFilters } = apiFilters || {};

  if (__dateRange) {
    const withoutComplaintCreated = { ...baseFilters };
    delete withoutComplaintCreated.complaint_created_at;
    const { window, filters, ...rest } = query;
    return {
      ...rest,
      filters: mergeQueryFilters(withoutComplaintCreated, {
        ...dimensionFilters,
        entered_at: { gte: __dateRange.fromMs, lt: __dateRange.toMs },
      }),
    };
  }

  const { window, filters, ...rest } = query;
  return {
    ...rest,
    filters: baseFilters,
  };
}

function sanitizeLiveOpenSnapshotQueries(queries) {
  for (const [key, query] of Object.entries(queries)) {
    if (!query?.filters?.is_open) continue;
    if (query.grain === "daily") continue;
    if (DATE_RANGE_KPI_QUERY_KEYS.has(key)) continue;

    const filters = { ...(query.filters || {}) };
    if (filters.created_at == null) continue;
    delete filters.created_at;
    queries[key] = { ...query, filters };
  }
}

function sanitizeLiveOldestOpenAgeQuery(queries) {
  const query = queries.cl_oldest_open_age;
  if (!query) return;
  const filters = { ...(query.filters || {}) };
  delete filters.created_at;
  queries.cl_oldest_open_age = { ...query, filters };
}

function applyOverTimeChartQueries(queries, dashboardFilters, apiFilters, dateRangeBounds) {
  const sparklineDayLimit = Math.min(366, countDaysInDateRange(dateRangeBounds));
  for (const key of [
    "cl_chart_over_time_created_daily",
    "cl_chart_over_time_created_weekly",
    "cl_chart_over_time_created_monthly",
  ]) {
    if (!queries[key]) continue;
    queries[key] = {
      ...applySelectedDateRangeToQuery(queries[key], dashboardFilters, apiFilters),
      limit: sparklineDayLimit,
    };
  }
  for (const key of [
    "cl_chart_over_time_resolved_daily",
    "cl_chart_over_time_resolved_weekly",
    "cl_chart_over_time_resolved_monthly",
  ]) {
    if (!queries[key]) continue;
    queries[key] = {
      ...applyEnteredAtDateRangeToQuery(queries[key], dashboardFilters, apiFilters),
      limit: sparklineDayLimit,
    };
  }
}

export function buildBatchQueries(dashboardFilters) {
  const apiFilters = buildGlobalApiFilters(dashboardFilters);
  const dimensionOnlyFilters = apiFilters.__dateRange
    ? { __dateRange: apiFilters.__dateRange }
    : {};
  const queries = {};

  for (const [key, query] of Object.entries(FILTER_DIMENSION_QUERIES)) {
    queries[key] = applyDashboardFiltersToQuery(query, dimensionOnlyFilters);
  }
  for (const [key, query] of Object.entries(BATCH_QUERIES)) {
    queries[key] = applyDashboardFiltersToQuery(query, apiFilters);
  }
  sanitizeLiveOpenSnapshotQueries(queries);
  sanitizeLiveOldestOpenAgeQuery(queries);

  const dateRangeBounds = selectedDateRangeBounds(dashboardFilters, apiFilters);
  if (dateRangeBounds) {
    const { __dateRange, ...dimensionFilters } = apiFilters;
    const sparklineDayLimit = Math.min(366, countDaysInDateRange(dateRangeBounds));
    for (const key of DATE_RANGE_KPI_QUERY_KEYS) {
      if (!queries[key]) continue;
      if (
        key === "cl_new_created_prior" ||
        key === "cl_resolution_rate_prior" ||
        key === "cl_resolution_cohort_resolved_prior" ||
        key === "cl_first_assignment_rate_prior" ||
        key === "cl_first_assignment_assigned_prior" ||
        key === "cl_first_assignment_first_only_prior" ||
        key === "cl_sla_compliance_rate_prior" ||
        key === "cl_sla_compliant_resolved_prior"
      ) {
        const baseFilters = { ...(queries[key].filters || {}) };
        delete baseFilters.created_at;
        queries[key] = {
          ...queries[key],
          filters: mergeQueryFilters(baseFilters, {
            ...dimensionFilters,
            created_at: priorPeriodCreatedAtFilter(dateRangeBounds),
          }),
        };
        delete queries[key].window;
      } else if (
        key === "cl_resolved_date_range_prior" ||
        key === "cl_avg_resolution_time_prior" ||
        key === "cl_reopen_rate_prior" ||
        key === "cl_reopen_rate_reopened_prior" ||
        key === "cl_csat_avg_prior" ||
        key === "cl_resolved_on_time_rate_prior" ||
        key === "cl_resolved_on_time_compliant_prior"
      ) {
        const baseFilters = { ...(queries[key].filters || {}) };
        delete baseFilters.resolved_at;
        delete baseFilters.created_at;
        queries[key] = {
          ...queries[key],
          filters: mergeQueryFilters(baseFilters, {
            ...dimensionFilters,
            resolved_at: priorPeriodCreatedAtFilter(dateRangeBounds),
          }),
        };
        delete queries[key].window;
      } else if (key === "cl_open_complaints_prior") {
        const baseFilters = { ...(queries[key].filters || {}) };
        delete baseFilters.snapshot_date;
        queries[key] = {
          ...queries[key],
          filters: mergeQueryFilters(baseFilters, {
            ...dimensionFilters,
            snapshot_date: { eq: priorPeriodEndDateIso(dateRangeBounds, dashboardFilters.dateFrom) },
          }),
        };
        delete queries[key].window;
      } else if (
        key === "cl_new_created_sparkline" ||
        key === "cl_open_complaints_sparkline" ||
        key === "cl_resolution_rate_sparkline"
      ) {
        queries[key] = {
          ...applySelectedDateRangeToQuery(queries[key], dashboardFilters, apiFilters),
          limit: sparklineDayLimit,
        };
      } else if (
        key === "cl_resolved_date_range_sparkline" ||
        key === "cl_resolved_on_time_rate_sparkline"
      ) {
        queries[key] =
          key === "cl_resolved_date_range_sparkline"
            ? {
                ...applyEnteredAtDateRangeToQuery(
                  queries[key],
                  dashboardFilters,
                  apiFilters
                ),
                limit: sparklineDayLimit,
              }
            : {
                ...applyResolvedAtDateRangeToQuery(
                  queries[key],
                  dashboardFilters,
                  apiFilters
                ),
                limit: sparklineDayLimit,
              };
      } else if (
        key === "cl_resolved_date_range_count" ||
        key === "cl_avg_resolution_time" ||
        key === "cl_reopen_rate_count" ||
        key === "cl_reopen_rate_reopened_count" ||
        key === "cl_csat_avg" ||
        key === "cl_resolved_on_time_rate_count" ||
        key === "cl_resolved_on_time_compliant_count"
      ) {
        queries[key] = applyResolvedAtDateRangeToQuery(
          queries[key],
          dashboardFilters,
          apiFilters
        );
      } else {
        queries[key] = applySelectedDateRangeToQuery(
          queries[key],
          dashboardFilters,
          apiFilters
        );
      }
    }
    applyOverTimeChartQueries(queries, dashboardFilters, apiFilters, dateRangeBounds);
  }

  if (queries.cl_chart_categories_pw) {
    queries.cl_chart_categories_pw = {
      ...queries.cl_chart_categories_pw,
      filters: mergeQueryFilters(queries.cl_chart_categories_pw.filters, {
        created_at: priorWeekCreatedAtFilter(),
      }),
    };
  }

  if (!apiFilters.__dateRange) {
    const priorWeekFilter = { created_at: priorWeekCreatedAtFilter() };
    const priorWeekResolvedFilter = { resolved_at: priorWeekCreatedAtFilter() };
    for (const key of ["cl_reg_prior_week", "cl_open_prior_week", "rs_breach_prior_week"]) {
      if (queries[key]) {
        queries[key] = {
          ...queries[key],
          filters: mergeQueryFilters(queries[key].filters, {
            ...apiFilters,
            ...priorWeekFilter,
          }),
        };
      }
    }
    for (const key of [
      "cl_res_prior_week",
      "rs_sla_compliance_prior_week",
      "ce_reopen_prior_week",
      "ce_csat_prior_week",
    ]) {
      if (queries[key]) {
        queries[key] = {
          ...queries[key],
          filters: mergeQueryFilters(queries[key].filters, {
            ...apiFilters,
            ...priorWeekResolvedFilter,
          }),
        };
      }
    }
  }

  if (queries.ev_table_stage_dwell) {
    queries.ev_table_stage_dwell = normalizeStageDwellQuery(
      queries.ev_table_stage_dwell,
      apiFilters
    );
  }

  if (queries.ev_chart_resolution_dwell_subtype) {
    queries.ev_chart_resolution_dwell_subtype = normalizeStageDwellQuery(
      queries.ev_chart_resolution_dwell_subtype,
      apiFilters
    );
  }

  applyTodayKpiQueries(queries, apiFilters);
  applyMapWowQueries(queries, dashboardFilters, apiFilters, dateRangeBounds);

  return queries;
}

export function formatDimensionLabel(code) {
  const humanized = String(code).replace(/([a-z])([A-Z])/g, "$1 $2");
  const wardMatch = humanized.match(/ward[_\s-]?(\d+)/i);
  if (wardMatch) return `Ward ${wardMatch[1]}`;

  const dot = humanized.lastIndexOf(".");
  if (dot >= 0) {
    return humanized
      .slice(dot + 1)
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  const parts = humanized.split("_").filter(Boolean);
  if (parts.length > 2) {
    return parts
      .slice(-2)
      .join(" ")
      .replace(/_/g, " ");
  }

  return humanized.replace(/_/g, " ");
}

function parseDimensionOptions(result, key) {
  if (!result?.rows?.length) return [];
  return result.rows
    .filter((row) => row[key] != null && row[key] !== "")
    .map((row) => ({
      id: String(row[key]),
      label: formatDimensionLabel(String(row[key])),
    }));
}

export function parseFilterOptions(results) {
  return {
    geography: [
      { id: "all", label: "All wards" },
      ...parseDimensionOptions(results?.cl_filter_wards, "ward_code"),
    ],
    complaintType: [
      { id: "all", label: "All types" },
      ...parseDimensionOptions(results?.cl_filter_categories, "service_code"),
    ],
  };
}

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const UNSUPPORTED_VALUE = "—";
export const LOADING_VALUE = "…";

function daysElapsedThisWeek() {
  const day = new Date().getDay();
  return day === 0 ? 7 : day;
}

function hoursElapsedToday() {
  return Math.max(new Date().getHours(), 1);
}

function formatPercentDelta() {
  return UNSUPPORTED_VALUE;
}

function formatOpenRateComplement(results) {
  const raw = results?.rs_closure_rate?.rows?.[0]?.pct;
  if (raw == null) return UNSUPPORTED_VALUE;
  const pct = Number(raw) <= 1 ? Number(raw) * 100 : Number(raw);
  if (!Number.isFinite(pct)) return UNSUPPORTED_VALUE;
  return `${Math.round(100 - pct)}%`;
}

function slaComplianceComplementPercent(ratio) {
  const pct = normalizeRatioPercent(ratio);
  if (pct == null) return null;
  return 100 - pct;
}

function formatSlaComplianceComplement(results, queryKey = "cl_sla_compliance_rate_count") {
  const complement = slaComplianceComplementPercent(
    readMetricRatio(results, queryKey, "pct")
  );
  return complement == null ? UNSUPPORTED_VALUE : `${complement.toFixed(1)}%`;
}

function formatNetBacklogDaily(results) {
  const inflow = results?.rs_inflow_daily?.rows?.[0]?.total;
  const outflow = results?.rs_outflow_daily?.rows?.[0]?.total;
  if (inflow == null || outflow == null) return UNSUPPORTED_VALUE;
  const net = Math.round(Number(inflow) - Number(outflow));
  if (!Number.isFinite(net)) return UNSUPPORTED_VALUE;
  return net > 0 ? `+${net}` : String(net);
}

function formatSignedInteger(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return UNSUPPORTED_VALUE;
  return n > 0 ? `+${n}` : String(n);
}

function formatMsAsDays(ms) {
  const days = Number(ms) / MS_PER_DAY;
  return Number.isFinite(days) ? days.toFixed(1) : UNSUPPORTED_VALUE;
}

function formatMsAsHours(ms) {
  const hours = Number(ms) / MS_PER_HOUR;
  return Number.isFinite(hours) ? hours.toFixed(1) : UNSUPPORTED_VALUE;
}

function formatMsDurationCompact(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return "";
  const hours = n / MS_PER_HOUR;
  if (hours < 48) {
    const rounded = Math.round(hours * 10) / 10;
    const formatted = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
    return `${formatted} ${rounded === 1 ? "hr" : "hrs"}`;
  }
  const days = n / MS_PER_DAY;
  const rounded = Math.round(days * 10) / 10;
  const formatted = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${formatted} ${rounded === 1 ? "day" : "days"}`;
}

function formatMsAsHoursOrDays(ms) {
  const formatted = formatMsDurationCompact(ms);
  return formatted || UNSUPPORTED_VALUE;
}

function formatDurationDeltaDisplay(deltaMs) {
  if (deltaMs == null || !Number.isFinite(deltaMs)) return null;
  if (deltaMs === 0) return `▲ ${formatMsDurationCompact(0) || "0 hrs"}`;
  const arrow = deltaMs > 0 ? "▲" : "▼";
  return `${arrow} ${formatMsDurationCompact(Math.abs(deltaMs))}`;
}

function formatRatingDeltaDisplay(delta) {
  if (delta == null || !Number.isFinite(delta)) return null;
  if (delta === 0) return "▲ 0.0";
  const arrow = delta > 0 ? "▲" : "▼";
  return `${arrow} ${Math.abs(delta).toFixed(1)}`;
}

function formatSparklineKpiDeltaDisplay(delta, config) {
  if (config?.deltaMode === "duration") return formatDurationDeltaDisplay(delta);
  if (config?.deltaMode === "rating") return formatRatingDeltaDisplay(delta);
  return formatSparklineDeltaDisplay(delta);
}

function formatLeaderboardRank(subMetric, results) {
  if (!subMetric.queryKey) return UNSUPPORTED_VALUE;
  const rows = results?.[subMetric.queryKey]?.rows;
  if (!rows?.length) return UNSUPPORTED_VALUE;
  return "1";
}

export function formatSubMetricValue(subMetric, results) {
  if (!subMetric || subMetric.format === "na" || subMetric.format === "text") {
    return UNSUPPORTED_VALUE;
  }

  if (subMetric.format === "percentDelta" || subMetric.format === "percentPointDelta" || subMetric.format === "multiplier") {
    return formatPercentDelta();
  }

  if (subMetric.format === "ordinal") {
    return formatLeaderboardRank(subMetric, results);
  }

  if (subMetric.derived === "dailyAvgFromWeekly") {
    const raw = results?.cl_reg_weekly?.rows?.[0]?.total;
    if (raw == null) return UNSUPPORTED_VALUE;
    const avg = Number(raw) / daysElapsedThisWeek();
    return Number.isFinite(avg) ? avg.toFixed(1) : UNSUPPORTED_VALUE;
  }

  if (subMetric.derived === "hourlyAvgFromDaily") {
    const raw = results?.cl_reg_daily?.rows?.[0]?.total;
    if (raw == null) return UNSUPPORTED_VALUE;
    const avg = Number(raw) / hoursElapsedToday();
    return Number.isFinite(avg) ? avg.toFixed(1) : UNSUPPORTED_VALUE;
  }

  if (subMetric.derived === "openRateComplement") {
    return formatOpenRateComplement(results);
  }

  if (subMetric.derived === "slaComplianceComplement") {
    return formatSlaComplianceComplement(results, subMetric.queryKey);
  }

  if (subMetric.derived === "netBacklogDaily") {
    return formatNetBacklogDaily(results);
  }

  if (subMetric.derived === "openAgeMsToDays") {
    const ms = results?.[subMetric.queryKey]?.rows?.[0]?.[subMetric.measureKey];
    if (ms == null) return UNSUPPORTED_VALUE;
    const days = Math.floor(Number(ms) / MS_PER_DAY);
    return Number.isFinite(days) ? String(days) : UNSUPPORTED_VALUE;
  }

  if (!subMetric.queryKey) return UNSUPPORTED_VALUE;

  const queryResult = results?.[subMetric.queryKey];
  if (!queryResult?.rows?.length) return UNSUPPORTED_VALUE;

  const raw = queryResult.rows[0][subMetric.measureKey];
  if (raw == null) return UNSUPPORTED_VALUE;

  switch (subMetric.format) {
    case "integer":
      return String(Math.round(Number(raw)));
    case "percentInteger":
    case "percentNoDecimal": {
      const pct = Number(raw) <= 1 ? Number(raw) * 100 : Number(raw);
      return Number.isFinite(pct) ? `${Math.round(pct)}%` : UNSUPPORTED_VALUE;
    }
    case "percentOneDecimal": {
      const pct = Number(raw) <= 1 ? Number(raw) * 100 : Number(raw);
      return Number.isFinite(pct) ? `${pct.toFixed(1)}%` : UNSUPPORTED_VALUE;
    }
    case "decimalOne": {
      const n = Number(raw);
      return Number.isFinite(n) ? n.toFixed(1) : UNSUPPORTED_VALUE;
    }
    case "ratingOutOfFive": {
      const n = Number(raw);
      return Number.isFinite(n) ? `${n.toFixed(1)}/5` : UNSUPPORTED_VALUE;
    }
    case "decimalTwo": {
      const n = Number(raw);
      return Number.isFinite(n) ? n.toFixed(2) : UNSUPPORTED_VALUE;
    }
    case "hoursDays":
      return formatMsAsHoursOrDays(raw);
    case "hoursDecimal":
      return formatMsAsHours(raw);
    case "signedInteger":
      return formatSignedInteger(raw);
    default:
      return String(raw);
  }
}

export function buildAllSubMetricValues(results, loading) {
  const values = {};
  for (const metric of KPI_METRICS) {
    for (const sub of metric.subMetrics) {
      const key = subMetricValueKey(metric.id, sub.id);
      if (loading) {
        values[key] = LOADING_VALUE;
      } else {
        values[key] = formatSubMetricValue(sub, results);
      }
    }
  }
  return values;
}

export function getDisplayValue(metric, subMetricId, allValues, loading) {
  const sub = getSubMetricDef(metric, subMetricId);
  const key = subMetricValueKey(metric.id, sub.id);
  if (loading) return LOADING_VALUE;
  return allValues[key] ?? UNSUPPORTED_VALUE;
}

function readMetricCount(results, queryKey, measureKey = "total") {
  const raw = results?.[queryKey]?.rows?.[0]?.[measureKey];
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function readMetricRatio(results, queryKey, measureKey = "pct") {
  const result = results?.[queryKey];
  if (!result || result.error) return null;
  if (!Array.isArray(result.rows) || result.rows.length === 0) return null;
  const raw = result.rows[0][measureKey];
  if (raw == null) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function normalizeRatioPercent(value) {
  if (value == null || !Number.isFinite(value)) return null;
  return value <= 1 ? value * 100 : value;
}

function computeRatioFromCounts(results, resolvedKey, createdKey) {
  const resolved = readMetricCount(results, resolvedKey);
  const created = readMetricCount(results, createdKey);
  if (resolved == null || created == null) return null;
  if (created === 0) return 0;
  return resolved / created;
}

function computePercentPointDelta(currentRatio, priorRatio) {
  const current = normalizeRatioPercent(currentRatio);
  const prior = normalizeRatioPercent(priorRatio);
  if (current == null || prior == null) return null;
  return current - prior;
}

function readOldestOpenAgeDays(results, queryKey, measureKey = "max_age_ms") {
  const ms = results?.[queryKey]?.rows?.[0]?.[measureKey];
  if (ms == null) return null;
  const days = Math.floor(Number(ms) / MS_PER_DAY);
  return Number.isFinite(days) ? days : null;
}

function daysElapsedForOldestAgeDelta(dashboardFilters) {
  const bounds = getSelectedDateRangeBounds(dashboardFilters);
  if (bounds) {
    const effectiveEndMs = Math.min(bounds.toMs, Date.now() + 1);
    const durationMs = effectiveEndMs - bounds.fromMs;
    return Math.max(1, Math.ceil(durationMs / MS_PER_DAY));
  }
  return 1;
}

function priorOldestOpenAgeDays(currentDays, dashboardFilters) {
  if (currentDays == null) return null;
  return Math.max(0, currentDays - daysElapsedForOldestAgeDelta(dashboardFilters));
}

function oldestOpenAgeDeltaLabel(dashboardFilters) {
  return getSelectedDateRangeBounds(dashboardFilters) ? "vs period start" : "vs yesterday";
}

function resolveSparklineDelta(config, results, current, prior) {
  const measureKey = config.measureKey || "total";

  if (config.deltaMode === "percentPoint" && measureKey === "pct") {
    const currentRatio =
      (config.currentResolvedCountKey && config.currentCreatedCountKey
        ? computeRatioFromCounts(
            results,
            config.currentResolvedCountKey,
            config.currentCreatedCountKey
          )
        : null) ?? readMetricRatio(results, config.currentQueryKey, measureKey);

    const priorRatio =
      (config.priorResolvedCountKey && config.priorCreatedCountKey
        ? computeRatioFromCounts(
            results,
            config.priorResolvedCountKey,
            config.priorCreatedCountKey
          )
        : null) ?? readMetricRatio(results, config.priorQueryKey, measureKey);

    if (config.derived === "slaComplianceComplement") {
      const currentPct = normalizeRatioPercent(currentRatio);
      const priorPct = normalizeRatioPercent(priorRatio);
      if (currentPct == null || priorPct == null) return null;
      return 100 - currentPct - (100 - priorPct);
    }

    return computePercentPointDelta(currentRatio, priorRatio);
  }

  if (config.deltaMode === "duration" || config.deltaMode === "rating") {
    if (current == null || prior == null) return null;
    return current - prior;
  }

  return computeWowPercent(current, prior);
}

function normalizeSparklinePoint(raw, measureKey = "total") {
  const n = Number(raw) || 0;
  if (measureKey === "pct") {
    return n <= 1 ? Math.round(n * 1000) / 10 : Math.round(n * 10) / 10;
  }
  if (measureKey === "avg") {
    return Math.round(n * 10) / 10;
  }
  return Math.round(n);
}

function normalizeAnalyticsDateKey(value) {
  return normalizeCreatedDateKey(value);
}

export function parseSparkline7d(result, measureKey = "total", dateField = "created_date") {
  const rows = result?.rows;
  if (!rows?.length) return [];

  return [...rows]
    .sort((a, b) =>
      normalizeAnalyticsDateKey(a[dateField]).localeCompare(
        normalizeAnalyticsDateKey(b[dateField])
      )
    )
    .map((row) => normalizeSparklinePoint(row[measureKey], measureKey));
}

function parseSparklineForDateRange(
  result,
  bounds,
  measureKey = "total",
  dashboardFilters,
  dateField = "created_date"
) {
  if (!bounds) return parseSparkline7d(result, measureKey, dateField);

  const countsByDay = new Map();
  for (const row of result?.rows ?? []) {
    const key = normalizeAnalyticsDateKey(row[dateField]);
    if (!key) continue;
    countsByDay.set(key, normalizeSparklinePoint(row[measureKey], measureKey));
  }

  const dayKeys =
    dashboardFilters?.dateFrom && dashboardFilters?.dateTo
      ? eachCalendarDayInRange(dashboardFilters.dateFrom, dashboardFilters.dateTo)
      : Array.from({ length: countDaysInDateRange(bounds) }, (_, i) =>
          isoDateFromUtcMs(bounds.fromMs + i * MS_PER_DAY)
        );

  const points = dayKeys.map((dayKey) => countsByDay.get(dayKey) ?? 0);
  const hasSeriesData = points.some((value) => value > 0);
  if (!hasSeriesData && result?.rows?.length) {
    return parseSparkline7d(result, measureKey, dateField);
  }
  return points;
}

function sparklineHasPositiveValues(points) {
  return Array.isArray(points) && points.some((value) => value > 0);
}

function buildOpenBacklogSparklineFromFlows(liveOpen, dayKeys, filedSeries, resolvedSeries) {
  if (liveOpen == null || !Number.isFinite(liveOpen) || !dayKeys.length) return [];

  const filed = dayKeys.map((_, index) => filedSeries[index] ?? 0);
  const resolved = dayKeys.map((_, index) => resolvedSeries[index] ?? 0);
  const open = new Array(dayKeys.length);

  let filedAfter = 0;
  let resolvedAfter = 0;
  for (let index = dayKeys.length - 1; index >= 0; index -= 1) {
    open[index] = Math.max(0, Math.round(liveOpen - filedAfter + resolvedAfter));
    filedAfter += filed[index];
    resolvedAfter += resolved[index];
  }

  return open;
}

function computeOpenBacklogPriorFromFlows(liveOpen, filedTotal, resolvedTotal) {
  if (liveOpen == null || filedTotal == null || resolvedTotal == null) return null;
  const prior = liveOpen - filedTotal + resolvedTotal;
  return Number.isFinite(prior) ? prior : null;
}

function formatSparklineDeltaDisplay(deltaPercent) {
  if (deltaPercent == null || !Number.isFinite(deltaPercent)) return null;
  const arrow = deltaPercent >= 0 ? "▲" : "▼";
  const abs = Math.abs(deltaPercent);
  const rounded = Math.round(abs * 10) / 10;
  const formatted = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${arrow} ${formatted}%`;
}

function buildSparklineKpiExtras(metricId, results, loading, dashboardFilters) {
  const config = getSparklineKpiQueryConfig(metricId);
  const empty = {
    delta: null,
    deltaLabel: config?.deltaLabel || "WoW",
    deltaDisplay: null,
    sparkline: [],
  };

  if (!config || loading) return empty;

  let current;
  let prior;

  if (config.derived === "dailyAvgWow") {
    const curTotal = readMetricCount(results, config.currentQueryKey);
    const priorTotal = readMetricCount(results, config.priorQueryKey);
    current = curTotal == null ? null : curTotal / daysElapsedThisWeek();
    prior = priorTotal == null ? null : priorTotal / 7;
  } else if (config.derived === "oldestOpenAge") {
    current = readOldestOpenAgeDays(results, config.currentQueryKey, config.measureKey);
    prior = priorOldestOpenAgeDays(current, dashboardFilters);
  } else {
    const measureKey = config.measureKey || "total";
    if (measureKey === "pct") {
      current = readMetricRatio(results, config.currentQueryKey, measureKey);
      prior = readMetricRatio(results, config.priorQueryKey, measureKey);
    } else {
      current = readMetricCount(results, config.currentQueryKey, measureKey);
      prior = readMetricCount(results, config.priorQueryKey, measureKey);
    }
  }

  const sparklineMeasureKey =
    config.sparklineMeasureKey || config.measureKey || "total";

  let sparkline = [];
  if (config.sparklineQueryKey) {
    if (config.sparklineMode === "recentDays") {
      const dayCount = config.recentDays || 7;
      sparkline = parseSparklineForDateRange(
        results?.[config.sparklineQueryKey],
        recentEatDayBounds(dayCount),
        sparklineMeasureKey,
        eatRecentDaysDashboardFilters(dayCount),
        config.sparklineDateField || "created_date"
      );
    } else {
      const dateRangeBounds =
        config.sparklineMode === "dateRange"
          ? getSelectedDateRangeBounds(dashboardFilters)
          : null;

      sparkline = dateRangeBounds
        ? parseSparklineForDateRange(
            results?.[config.sparklineQueryKey],
            dateRangeBounds,
            sparklineMeasureKey,
            dashboardFilters,
            config.sparklineDateField || "created_date"
          )
        : parseSparkline7d(
            results?.[config.sparklineQueryKey],
            sparklineMeasureKey,
            config.sparklineDateField || "created_date"
          );
    }
  }

  if (config.derived === "openBacklogFromFlows") {
    const dateRangeBounds =
      config.sparklineMode === "dateRange"
        ? getSelectedDateRangeBounds(dashboardFilters)
        : null;

    if (dateRangeBounds) {
      const dayKeys =
        dashboardFilters?.dateFrom && dashboardFilters?.dateTo
          ? eachCalendarDayInRange(dashboardFilters.dateFrom, dashboardFilters.dateTo)
          : [];

      if (!sparklineHasPositiveValues(sparkline) && dayKeys.length) {
        const filedSeries = parseSparklineForDateRange(
          results?.[config.filedSparklineQueryKey],
          dateRangeBounds,
          "total",
          dashboardFilters,
          "created_date"
        );
        const resolvedSeries = parseSparklineForDateRange(
          results?.[config.resolvedSparklineQueryKey],
          dateRangeBounds,
          "total",
          dashboardFilters,
          "occurred_date"
        );
        sparkline = buildOpenBacklogSparklineFromFlows(
          current,
          dayKeys,
          filedSeries,
          resolvedSeries
        );
      }

      if (prior == null && current != null) {
        const filedTotal = readMetricCount(results, config.filedCountQueryKey);
        const resolvedTotal = readMetricCount(results, config.resolvedCountQueryKey);
        prior = computeOpenBacklogPriorFromFlows(current, filedTotal, resolvedTotal);
      }
    }
  }

  const delta = resolveSparklineDelta(config, results, current, prior);
  const deltaLabel =
    config.derived === "oldestOpenAge"
      ? oldestOpenAgeDeltaLabel(dashboardFilters)
      : config.deltaLabel;

  return {
    delta,
    deltaLabel,
    deltaDisplay: formatSparklineKpiDeltaDisplay(delta, config),
    sparkline,
  };
}

export function buildKpiCardData(
  metric,
  subMetricId,
  results,
  subMetricValues,
  loading,
  dashboardFilters
) {
  const sub = getSubMetricDef(metric, subMetricId);
  const value = loading
    ? LOADING_VALUE
    : subMetricValues[subMetricValueKey(metric.id, sub.id)] ?? UNSUPPORTED_VALUE;

  const hasList = isKpiListMetric(metric.id);
  const listItems = hasList && !loading ? parseKpiListItems(results, metric.id, 5) : [];
  const vizType = getMetricVizType(metric);
  const isSparkline = vizType === VIZ_TYPE.NUMBER_TILE_SPARKLINE;
  const isDeltaTile = vizType === VIZ_TYPE.NUMBER_TILE_DELTA;
  const hasDeltaConfig = Boolean(getSparklineKpiQueryConfig(metric.id));

  let deltaExtras = {
    delta: null,
    deltaDisplay: null,
    deltaLabel: null,
    sparkline: [],
  };
  if ((isSparkline || isDeltaTile) && hasDeltaConfig) {
    deltaExtras = buildSparklineKpiExtras(
      metric.id,
      results,
      loading,
      dashboardFilters
    );
  }

  const contextText = isSparkline
    ? null
    : buildKpiContextText(metric.id, results, sub.label);
  const base = {
    title: getKpiDisplayTitle(metric),
    value,
    context: contextText,
    status: resolveThresholdStatus(metric.id, value),
    listItems,
    hasList,
    vizType,
  };

  if (!isSparkline && !isDeltaTile) return base;

  const deltaClass = resolveKpiDeltaClass(metric.id, deltaExtras.delta, value);

  if (!isSparkline) {
    return {
      ...base,
      delta: deltaExtras.delta,
      deltaLabel: deltaExtras.deltaLabel,
      deltaDisplay: deltaExtras.deltaDisplay,
      deltaClass,
    };
  }

  return {
    ...base,
    ...deltaExtras,
    deltaClass,
    seriesColor: statusValueToCssColor(
      getStatusValueClass(resolveThresholdStatus(metric.id, value))
    ),
  };
}

export function buildAllKpiCardData(
  results,
  subMetricValues,
  resolveSubMetricId,
  loading,
  dashboardFilters
) {
  const data = {};
  for (const metric of KPI_METRICS) {
    const subMetricId = resolveSubMetricId(metric);
    data[metric.id] = buildKpiCardData(
      metric,
      subMetricId,
      results,
      subMetricValues,
      loading,
      dashboardFilters
    );
  }
  return data;
}

function sortRowsByTotalDesc(rows, labelKey) {
  return [...rows].sort((a, b) => {
    const countDiff = (Number(b.total) || 0) - (Number(a.total) || 0);
    if (countDiff !== 0) return countDiff;
    return String(a[labelKey] ?? "").localeCompare(String(b[labelKey] ?? ""));
  });
}

export function parseBarChart(result, labelKey) {
  if (!result?.rows?.length) return [];
  return sortRowsByTotalDesc(result.rows, labelKey).map((row) => ({
    label: String(row[labelKey] ?? "Unknown"),
    count: Number(row.total) || 0,
  }));
}

export function parseComplaintsByTypeStackedChart(result, { maxCategories = 8 } = {}) {
  if (!result?.rows?.length) {
    return {
      categories: [],
      series: [{ name: "Filed", data: [] }],
      colors: ["var(--chart-1)"],
    };
  }

  const ranked = sortRowsByTotalDesc(result.rows, "service_code").slice(0, maxCategories);

  return {
    categories: ranked.map((row) =>
      formatDimensionLabel(String(row.service_code ?? "Unknown"))
    ),
    series: [
      {
        name: "Filed",
        data: ranked.map((row) => Number(row.total) || 0),
      },
    ],
    colors: ["var(--chart-1)"],
  };
}

export function parseDepartmentsBarChart(result, { maxDepartments = 12 } = {}) {
  if (!result?.rows?.length) return [];

  const totalsByDepartment = new Map();

  for (const row of result.rows) {
    const count = Number(row.total) || 0;
    if (count <= 0) continue;

    const departmentCode = resolveDepartmentForServiceType(
      row.service_code,
      row.department_code
    );
    totalsByDepartment.set(
      departmentCode,
      (totalsByDepartment.get(departmentCode) ?? 0) + count
    );
  }

  return [...totalsByDepartment.entries()]
    .map(([departmentCode, count]) => ({
      label: formatDepartmentLabel(departmentCode),
      count,
      departmentCode,
    }))
    .sort((a, b) => {
      const countDiff = b.count - a.count;
      if (countDiff !== 0) return countDiff;
      return a.label.localeCompare(b.label);
    })
    .slice(0, maxDepartments)
    .map(({ label, count }) => ({ label, count }));
}

export function parseDepartmentResolutionRateBarChart(result, { maxDepartments = 12 } = {}) {
  if (!result?.rows?.length) return [];

  const totalsByDepartment = new Map();

  for (const row of result.rows) {
    const filed = Number(row.filed) || 0;
    const resolved = Number(row.resolved) || 0;
    if (filed <= 0) continue;

    const departmentCode = resolveDepartmentForServiceType(
      row.service_code,
      row.department_code
    );
    const bucket = totalsByDepartment.get(departmentCode) ?? { filed: 0, resolved: 0 };
    bucket.filed += filed;
    bucket.resolved += resolved;
    totalsByDepartment.set(departmentCode, bucket);
  }

  return [...totalsByDepartment.entries()]
    .map(([departmentCode, { filed, resolved }]) => ({
      label: formatDepartmentLabel(departmentCode),
      count: overTimeRatioPercentOneDecimal(resolved, filed),
      departmentCode,
    }))
    .sort((a, b) => {
      const rateDiff = b.count - a.count;
      if (rateDiff !== 0) return rateDiff;
      return a.label.localeCompare(b.label);
    })
    .slice(0, maxDepartments)
    .map(({ label, count }) => ({ label, count }));
}

function parseWardCountSeries(result) {
  if (!result?.rows?.length) return [];

  return result.rows
    .filter((row) => {
      const code = String(row.ward_code ?? "").trim();
      return code && code !== "null";
    })
    .map((row) => {
      const wardCode = String(row.ward_code);
      return {
        wardCode,
        label: formatDimensionLabel(wardCode),
        count: Number(row.total) || 0,
      };
    });
}

function parseWardSlaBuckets(result) {
  const byWard = {};

  for (const row of result?.rows ?? []) {
    const wardCode = String(row.ward_code ?? "").trim();
    if (!wardCode || wardCode === "null") continue;

    const bucket = String(row.sla_status_bucket ?? "").toLowerCase();
    const count = Number(row.total) || 0;
    if (!byWard[wardCode]) {
      byWard[wardCode] = { slaWithin: 0, slaApproaching: 0, slaBreached: 0 };
    }

    if (bucket === "within") byWard[wardCode].slaWithin += count;
    else if (bucket === "approaching") byWard[wardCode].slaApproaching += count;
    else if (bucket === "breached") byWard[wardCode].slaBreached += count;
  }

  return byWard;
}

export function parseGeographyMapLayers(
  wowCurrentResult,
  wowPriorResult,
  slaBreachResult,
  openResult,
  slaBucketsResult
) {
  const currentByWard = Object.fromEntries(
    parseWardCountSeries(wowCurrentResult).map((row) => [row.wardCode, row.count])
  );
  const priorByWard = Object.fromEntries(
    parseWardCountSeries(wowPriorResult).map((row) => [row.wardCode, row.count])
  );
  const breachedByWard = Object.fromEntries(
    parseWardCountSeries(slaBreachResult).map((row) => [row.wardCode, row.count])
  );
  const openByWard = Object.fromEntries(
    parseWardCountSeries(openResult).map((row) => [row.wardCode, row.count])
  );
  const slaBucketsByWard = parseWardSlaBuckets(slaBucketsResult);
  const wowCodes = new Set([...Object.keys(currentByWard), ...Object.keys(priorByWard)]);
  const slaCodes = new Set([
    ...Object.keys(breachedByWard),
    ...Object.keys(openByWard),
    ...Object.keys(slaBucketsByWard),
  ]);
  const allCodes = new Set([...wowCodes, ...slaCodes]);
  const wardDetails = {};

  for (const wardCode of allCodes) {
    const current = currentByWard[wardCode] ?? 0;
    const prior = priorByWard[wardCode] ?? 0;
    const open = openByWard[wardCode] ?? 0;
    const breached = breachedByWard[wardCode] ?? 0;
    const buckets = slaBucketsByWard[wardCode] ?? {
      slaWithin: 0,
      slaApproaching: 0,
      slaBreached: 0,
    };
    const wowPct =
      prior <= 0 && current > 0
        ? Number.POSITIVE_INFINITY
        : prior <= 0
          ? 0
          : ((current - prior) / prior) * 100;

    wardDetails[wardCode] = {
      wardCode,
      label: formatDimensionLabel(wardCode),
      count: current,
      current,
      prior,
      wowPct,
      total: current,
      open,
      breached,
      breachSharePct: open > 0 ? (breached / open) * 100 : 0,
      ...buckets,
    };
  }

  const wow_change = [...wowCodes].map((wardCode) => {
    const detail = wardDetails[wardCode];
    return {
      wardCode,
      label: detail.label,
      count: detail.current,
      current: detail.current,
      prior: detail.prior,
      wowPct: detail.wowPct,
      ...detail,
    };
  });

  const sla_breach = [...slaCodes].map((wardCode) => {
    const detail = wardDetails[wardCode] ?? {
      wardCode,
      label: formatDimensionLabel(wardCode),
      count: 0,
      open: 0,
      breached: 0,
      breachSharePct: 0,
      slaWithin: 0,
      slaApproaching: 0,
      slaBreached: 0,
    };

    return {
      wardCode,
      label: detail.label,
      count: detail.breached,
      open: detail.open,
      breached: detail.breached,
      breachSharePct: detail.breachSharePct,
      current: detail.current,
      prior: detail.prior,
      wowPct: detail.wowPct,
      total: detail.total,
      slaWithin: detail.slaWithin,
      slaApproaching: detail.slaApproaching,
      slaBreached: detail.slaBreached,
    };
  });

  return { wow_change, sla_breach, wardDetails };
}

/** Open complaints for the map — one row per service_request_id. */
export function parseComplaintMapPins(result) {
  if (!result?.rows?.length) return [];

  return result.rows
    .map((row, index) => {
      const lat = Number(row.latitude);
      const lng = Number(row.longitude);
      const serviceCode = String(row.service_code ?? "").trim();
      const wardCode = String(row.ward_code ?? "").trim();
      const serviceRequestId = String(row.service_request_id ?? "").trim();
      const count = Number(row.total) || 1;

      return {
        id: serviceRequestId || `pin-${index}`,
        serviceRequestId,
        wardCode,
        lat: Number.isFinite(lat) ? lat : null,
        lng: Number.isFinite(lng) ? lng : null,
        count,
        serviceCode: serviceCode ? formatDimensionLabel(serviceCode) : "Complaint",
        status: formatWorkflowStatusLabel(row.application_status),
      };
    })
    .filter((pin) => pin.wardCode || (pin.lat != null && pin.lng != null));
}

export function parseDepartmentFlowRatioBarChart(result, { maxDepartments = 12 } = {}) {
  if (!result?.rows?.length) return [];

  const totalsByDepartment = new Map();

  for (const row of result.rows) {
    const created = Number(row.filed) || 0;
    const resolved = Number(row.resolved) || 0;
    if (created <= 0) continue;

    const departmentCode = resolveDepartmentForServiceType(
      row.service_code,
      row.department_code
    );
    const bucket = totalsByDepartment.get(departmentCode) ?? { created: 0, resolved: 0 };
    bucket.created += created;
    bucket.resolved += resolved;
    totalsByDepartment.set(departmentCode, bucket);
  }

  return [...totalsByDepartment.entries()]
    .map(([departmentCode, { created, resolved }]) => ({
      label: formatDepartmentLabel(departmentCode),
      value: created > 0 ? resolved / created : 0,
      resolved,
      created,
      departmentCode,
    }))
    .filter((row) => row.created > 0)
    .sort((a, b) => {
      const ratioDiff = a.value - b.value;
      if (Math.abs(ratioDiff) > 0.0001) return ratioDiff;
      return a.label.localeCompare(b.label);
    })
    .slice(0, maxDepartments)
    .map(({ label, value, resolved, created }) => ({
      label,
      value,
      resolved,
      created,
    }));
}

export function parseOpenComplaintsByChannelPieChart(result) {
  if (!result?.rows?.length) return [];

  const totalsByChannel = new Map(PIE_CHART_CHANNELS.map((channel) => [channel.id, 0]));

  for (const row of result.rows) {
    const count = Number(row.total) || 0;
    if (count <= 0) continue;

    const channelId = resolveChannelForSource(row.source);
    if (!channelId) continue;

    totalsByChannel.set(channelId, (totalsByChannel.get(channelId) ?? 0) + count);
  }

  return PIE_CHART_CHANNELS.map((channel) => ({
    label: channel.label,
    count: totalsByChannel.get(channel.id) ?? 0,
    color: channel.color,
  }))
    .filter((slice) => slice.count > 0)
    .sort((a, b) => {
      const countDiff = b.count - a.count;
      if (countDiff !== 0) return countDiff;
      return a.label.localeCompare(b.label);
    });
}

export function parseOpenComplaintsByAgeHistogram(result) {
  const totalsByBucket = new Map(
    OPEN_COMPLAINT_AGE_BUCKETS.map((bucket) => [bucket.id, 0])
  );

  for (const row of result?.rows ?? []) {
    const count = Number(row.total) || 0;
    if (count <= 0) continue;

    const bucketId = resolveOpenComplaintAgeBucketId(row.aging_bucket);
    if (!bucketId) continue;

    totalsByBucket.set(bucketId, (totalsByBucket.get(bucketId) ?? 0) + count);
  }

  return OPEN_COMPLAINT_AGE_BUCKETS.map((bucket) => ({
    label: bucket.label,
    count: totalsByBucket.get(bucket.id) ?? 0,
  }));
}

function formatOfficerStackedLabel(uuid) {
  const id = String(uuid ?? "Unknown");
  if (!id || id === "null" || id === "undefined") return "Unassigned";
  if (id.length <= 8) return id;
  return `Officer …${id.slice(-6)}`;
}

export function formatOfficerDisplayName(uuid) {
  return formatOfficerStackedLabel(uuid);
}

function buildOfficerDepartmentLookup(deptResult) {
  const totalsByOfficerDept = new Map();

  for (const row of deptResult?.rows ?? []) {
    const officerId = String(row.current_assignee_uuid ?? "").trim();
    if (!officerId || officerId === "null" || officerId === "undefined") continue;

    const deptCode = String(row.department_code ?? "").trim();
    if (!deptCode || deptCode === "null") continue;

    const count = Number(row.total) || 0;
    if (count <= 0) continue;

    const key = `${officerId}::${deptCode}`;
    totalsByOfficerDept.set(key, (totalsByOfficerDept.get(key) ?? 0) + count);
  }

  const bestDeptByOfficer = new Map();
  for (const [key, count] of totalsByOfficerDept.entries()) {
    const [officerId, deptCode] = key.split("::");
    const current = bestDeptByOfficer.get(officerId);
    if (!current || count > current.count) {
      bestDeptByOfficer.set(officerId, { deptCode, count });
    }
  }

  return new Map(
    [...bestDeptByOfficer.entries()].map(([officerId, { deptCode }]) => [officerId, deptCode])
  );
}

function buildOfficerEscalationLookup(escalationResult) {
  const lookup = new Map();
  for (const row of escalationResult?.rows ?? []) {
    const officerId = String(row.assignee_uuid ?? "").trim();
    if (!officerId || officerId === "null" || officerId === "undefined") continue;
    lookup.set(officerId, Number(row.escalated) || 0);
  }
  return lookup;
}

export function parseEmployeePerformanceTable(
  performanceResult,
  deptResult,
  escalationResult,
  limit = 40
) {
  if (!performanceResult?.rows?.length) return [];

  const deptByOfficer = buildOfficerDepartmentLookup(deptResult);
  const escalatedByOfficer = buildOfficerEscalationLookup(escalationResult);

  return performanceResult.rows
    .filter((row) => {
      const officerId = String(row.current_assignee_uuid ?? "").trim();
      return officerId && officerId !== "null" && officerId !== "undefined";
    })
    .slice(0, limit)
    .map((row, index) => {
      const officerId = String(row.current_assignee_uuid);
      const assigned = Number(row.assigned) || 0;
      const escalated = escalatedByOfficer.get(officerId) ?? 0;
      const deptCode = deptByOfficer.get(officerId);
      const avgCsat = Number(row.avg_csat);

      return {
        id: `officer-${index}-${officerId}`,
        officerName: formatOfficerDisplayName(officerId),
        role: "—",
        dept: deptCode ? formatDepartmentLabel(deptCode) : "—",
        assigned,
        open: Number(row.open) || 0,
        resolved: Number(row.resolved) || 0,
        reopenRate: Number(row.reopen_rate),
        avgCsat: Number.isFinite(avgCsat) ? avgCsat : null,
        escalationRate: assigned > 0 ? escalated / assigned : null,
      };
    });
}

export function parseComplaintsAtRiskTable(result, limit = 50) {
  if (!result?.rows?.length) return [];

  return result.rows
    .map((row, index) => {
      const complaintId = String(row.service_request_id ?? "").trim();
      if (!complaintId || complaintId === "null") return null;

      const slaBucket = String(row.sla_status_bucket ?? "");
      const { slaLabel, slaLevel } = resolveSlaRiskPresentation(slaBucket);
      const breachDurationMs = computeBreachDurationMs(
        row.open_age_ms,
        row.sla_target_ms,
        slaBucket
      );
      const applicationStatus = String(row.application_status ?? "");
      const subtypeKey = String(row.service_code ?? "");
      const typeKey = String(row.service_group ?? "");

      return {
        id: complaintId,
        typeLabel: typeKey ? formatDimensionLabel(typeKey) : "—",
        subtypeLabel: subtypeKey ? formatDimensionLabel(subtypeKey) : "—",
        locality: row.ward_code ? formatDimensionLabel(String(row.ward_code)) : "—",
        ownerName: formatOfficerDisplayName(row.current_assignee_uuid),
        ownerRole: "—",
        status: normalizeWorkflowStatusKey(applicationStatus),
        statusLabel: formatWorkflowStatusLabel(applicationStatus),
        slaLabel,
        slaLevel,
        breachDurationMs,
        breachDurationLabel: formatBreachDurationCompact(breachDurationMs),
        _rowKey: `risk-${index}-${complaintId}`,
      };
    })
    .filter(Boolean)
    .sort((left, right) => (right.breachDurationMs ?? -1) - (left.breachDurationMs ?? -1))
    .slice(0, limit);
}

function eatWeekdayIndex(isoDate) {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: ANALYTICS_TIME_ZONE,
    weekday: "long",
  }).format(new Date(`${isoDate}T12:00:00+03:00`));
  const order = {
    Monday: 0,
    Tuesday: 1,
    Wednesday: 2,
    Thursday: 3,
    Friday: 4,
    Saturday: 5,
    Sunday: 6,
  };
  return order[weekday] ?? 0;
}

function eatWeekStartIso(isoDate) {
  return shiftEatIsoDate(isoDate, -eatWeekdayIndex(isoDate));
}

function eachRecentEatDays(count) {
  const todayIso = todayEatIso();
  return Array.from({ length: count }, (_, index) =>
    shiftEatIsoDate(todayIso, -(count - 1 - index))
  );
}

function eachRecentEatWeekStarts(count) {
  const weekStart = eatWeekStartIso(todayEatIso());
  return Array.from({ length: count }, (_, index) =>
    shiftEatIsoDate(weekStart, -7 * (count - 1 - index))
  );
}

function eachRecentEatMonths(count) {
  const todayIso = todayEatIso();
  const [year, month] = todayIso.split("-").map(Number);
  return Array.from({ length: count }, (_, index) => {
    const offset = count - 1 - index;
    let m = month - offset;
    let y = year;
    while (m <= 0) {
      m += 12;
      y -= 1;
    }
    return `${y}-${String(m).padStart(2, "0")}`;
  });
}

function formatWeekStackedLabel(value, _bucketCount) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value ?? "Unknown");
  return `Wk ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

function formatOverTimeDailyLabel(value) {
  const key = normalizeCreatedDateKey(value);
  const d = new Date(`${key}T12:00:00`);
  if (Number.isNaN(d.getTime())) return key;
  return d.toLocaleDateString(undefined, { weekday: "short" });
}

function formatOverTimeWeeklyLabel(value) {
  const key = normalizeCreatedDateKey(value);
  const d = new Date(`${key}T12:00:00+03:00`);
  if (!Number.isNaN(d.getTime())) {
    return `Wk ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  }
  return formatWeekStackedLabel(value);
}

function formatOverTimeMonthlyLabel(value) {
  const str = String(value ?? "");
  const match = str.match(/^(\d{4})-(\d{2})/);
  if (!match) return str;
  const d = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  if (Number.isNaN(d.getTime())) return str;
  return d.toLocaleDateString(undefined, { month: "short" });
}

const OVER_TIME_PERIOD_LIMITS = {
  daily: 7,
  weekly: 4,
  monthly: 6,
};

function eachMonthsEndingAt(endYYYYMM, count) {
  const [year, month] = endYYYYMM.split("-").map(Number);
  return Array.from({ length: count }, (_, index) => {
    const offset = count - 1 - index;
    let m = month - offset;
    let y = year;
    while (m <= 0) {
      m += 12;
      y -= 1;
    }
    return `${y}-${String(m).padStart(2, "0")}`;
  });
}

function overTimeDailyBucketKeys(dashboardFilters) {
  const limit = OVER_TIME_PERIOD_LIMITS.daily;
  if (dashboardFilters?.dateRangeActive && dashboardFilters?.dateFrom && dashboardFilters?.dateTo) {
    const days = eachCalendarDayInRange(dashboardFilters.dateFrom, dashboardFilters.dateTo);
    return days.length > limit ? days.slice(-limit) : days;
  }
  return eachRecentEatDays(limit);
}

function overTimeWeeklyBucketKeys(dashboardFilters) {
  const limit = OVER_TIME_PERIOD_LIMITS.weekly;
  const endIso =
    dashboardFilters?.dateRangeActive && dashboardFilters?.dateTo
      ? dashboardFilters.dateTo
      : todayEatIso();
  const endWeek = eatWeekStartIso(endIso);
  return Array.from({ length: limit }, (_, index) =>
    shiftEatIsoDate(endWeek, -7 * (limit - 1 - index))
  );
}

function overTimeMonthlyBucketKeys(dashboardFilters) {
  const limit = OVER_TIME_PERIOD_LIMITS.monthly;
  const endMonth =
    dashboardFilters?.dateRangeActive && dashboardFilters?.dateTo
      ? dashboardFilters.dateTo.slice(0, 7)
      : todayEatIso().slice(0, 7);
  return eachMonthsEndingAt(endMonth, limit);
}

function lookupOverTimeCreatedBucket(createdMap, key) {
  if (createdMap.has(key)) return createdMap.get(key);
  const normalized = normalizeCreatedDateKey(key);
  if (createdMap.has(normalized)) return createdMap.get(normalized);
  for (const [mapKey, value] of createdMap.entries()) {
    if (normalizeCreatedDateKey(mapKey) === normalized) return value;
  }
  return null;
}

function lookupOverTimeResolvedCount(resolvedMap, key) {
  if (resolvedMap.has(key)) return resolvedMap.get(key);
  const normalized = normalizeCreatedDateKey(key);
  if (resolvedMap.has(normalized)) return resolvedMap.get(normalized);
  for (const [mapKey, value] of resolvedMap.entries()) {
    if (normalizeCreatedDateKey(mapKey) === normalized) return value;
  }
  return 0;
}

function trimOverTimeBucketKeys(keys, maxBuckets) {
  if (!maxBuckets || keys.length <= maxBuckets) return keys;
  return keys.slice(-maxBuckets);
}

const COMPLAINTS_OVER_TIME_SERIES_DEFS = [
  { key: "created", name: "Created", color: "var(--chart-1)", yAxisGroup: "count" },
  { key: "resolved", name: "Resolved", color: "var(--chart-2)", yAxisGroup: "count" },
  {
    key: "resolution_rate",
    name: "Resolution rate",
    color: "var(--chart-3)",
    yAxisGroup: "percent",
    dashArray: 5,
  },
  {
    key: "sla_compliance",
    name: "SLA compliance rate",
    color: "var(--chart-4)",
    yAxisGroup: "percent",
    dashArray: 5,
  },
];

function overTimeRatioPercentOneDecimal(numerator, denominator) {
  if (!denominator) return 0;
  const pct = (numerator / denominator) * 100;
  return Math.round(pct * 10) / 10;
}

function parseOverTimeCreatedRows(result, dateField) {
  const map = new Map();
  for (const row of result?.rows ?? []) {
    const key = normalizeCreatedDateKey(row[dateField]);
    if (!key) continue;
    map.set(key, {
      created: Number(row.created) || 0,
      resolved: Number(row.resolved) || 0,
      on_time: Number(row.on_time) || 0,
    });
  }
  return map;
}

function parseOverTimeResolvedRows(result, dateField) {
  const map = new Map();
  for (const row of result?.rows ?? []) {
    const key = normalizeCreatedDateKey(row[dateField]);
    if (!key) continue;
    map.set(key, Number(row.total) || 0);
  }
  return map;
}

function mergeOverTimeBucketKeys(createdMap, resolvedMap, bucketKeys) {
  if (Array.isArray(bucketKeys) && bucketKeys.length) return bucketKeys;
  const keys = new Set([...createdMap.keys(), ...resolvedMap.keys()]);
  return [...keys].sort();
}

function buildComplaintsOverTimePeriod(
  createdResult,
  resolvedResult,
  { dateField, resolvedDateField, formatLabel, bucketKeys, maxBuckets },
  dashboardFilters
) {
  const createdMap = parseOverTimeCreatedRows(createdResult, dateField);
  const resolvedMap = parseOverTimeResolvedRows(resolvedResult, resolvedDateField);
  let keys = mergeOverTimeBucketKeys(
    createdMap,
    resolvedMap,
    typeof bucketKeys === "function" ? bucketKeys(dashboardFilters) : bucketKeys
  );
  if (typeof bucketKeys !== "function" && !bucketKeys?.length) {
    keys = trimOverTimeBucketKeys(keys, maxBuckets);
  }

  const categories = keys.map((key, index) => formatLabel(key, index, keys.length));
  const series = COMPLAINTS_OVER_TIME_SERIES_DEFS.map((def) => ({
    name: def.name,
    color: def.color,
    yAxisGroup: def.yAxisGroup,
    dashArray: def.dashArray ?? 0,
    data: keys.map((key) => {
      const bucket = lookupOverTimeCreatedBucket(createdMap, key) ?? {
        created: 0,
        resolved: 0,
        on_time: 0,
      };
      const resolvedByDate = lookupOverTimeResolvedCount(resolvedMap, key);
      switch (def.key) {
        case "created":
          return bucket.created;
        case "resolved":
          return resolvedByDate;
        case "resolution_rate":
          return overTimeRatioPercentOneDecimal(
            bucket.resolved,
            bucket.created
          );
        case "sla_compliance":
          return overTimeRatioPercentOneDecimal(
            bucket.on_time,
            bucket.created
          );
        default:
          return 0;
      }
    }),
  }));

  return { categories, series };
}

export function parseComplaintsOverTimeChart(results, dashboardFilters) {
  return {
    title: "Complaints over time",
    defaultPeriod: "daily",
    periods: {
      daily: buildComplaintsOverTimePeriod(
        results?.cl_chart_over_time_created_daily,
        results?.cl_chart_over_time_resolved_daily,
        {
          dateField: "created_date",
          resolvedDateField: "occurred_date",
          formatLabel: formatOverTimeDailyLabel,
          bucketKeys: overTimeDailyBucketKeys,
        },
        dashboardFilters
      ),
      weekly: buildComplaintsOverTimePeriod(
        results?.cl_chart_over_time_created_weekly,
        results?.cl_chart_over_time_resolved_weekly,
        {
          dateField: "created_week_start",
          resolvedDateField: "occurred_week_start",
          formatLabel: formatOverTimeWeeklyLabel,
          bucketKeys: overTimeWeeklyBucketKeys,
        },
        dashboardFilters
      ),
      monthly: buildComplaintsOverTimePeriod(
        results?.cl_chart_over_time_created_monthly,
        results?.cl_chart_over_time_resolved_monthly,
        {
          dateField: "created_month",
          resolvedDateField: "occurred_month",
          formatLabel: formatOverTimeMonthlyLabel,
          bucketKeys: overTimeMonthlyBucketKeys,
        },
        dashboardFilters
      ),
    },
  };
}

function msToStackedHours(ms) {
  const hours = Number(ms) / 3600000;
  if (!Number.isFinite(hours) || hours <= 0) return 0;
  return Math.round(hours * 10) / 10;
}

const RESOLUTION_DWELL_STATUS_KEYS = new Set(
  RESOLUTION_DWELL_STACKED_SERIES.map((def) => def.key)
);

function rankPivotStackedCategories(entries, { sortBy = "total", sortBySegment } = {}) {
  const ranked = [...entries]
    .filter((entry) => entry.total > 0)
    .sort((a, b) => {
      if (sortBySegment) {
        const segmentDiff =
          (b.segments[sortBySegment] ?? 0) - (a.segments[sortBySegment] ?? 0);
        if (segmentDiff !== 0) return segmentDiff;
      } else if (sortBy !== "total") {
        const segmentDiff = (b.segments[sortBy] ?? 0) - (a.segments[sortBy] ?? 0);
        if (segmentDiff !== 0) return segmentDiff;
      }
      const totalDiff = b.total - a.total;
      if (totalDiff !== 0) return totalDiff;
      return String(a.key).localeCompare(String(b.key));
    });
  return ranked;
}

function parsePivotStackedChart(
  result,
  {
    categoryKey,
    segmentKey,
    segmentDefs,
    categoryLabel,
    maxCategories = 6,
    segmentFilter,
    segmentKeyNormalize = (value) => String(value ?? "").toUpperCase(),
    measureKey = "total",
    valueTransform = (value) => Number(value) || 0,
    aggregate = "sum",
    sortBy = "total",
    sortBySegment,
  }
) {
  if (!result?.rows?.length) {
    return { categories: [], series: [], colors: segmentDefs.map((def) => def.color) };
  }

  const categoryMap = new Map();

  for (const row of result.rows) {
    const segment = segmentKeyNormalize(row[segmentKey]);
    if (segmentFilter && !segmentFilter(segment)) continue;

    const category = String(row[categoryKey] ?? "Unknown");
    if (!categoryMap.has(category)) categoryMap.set(category, {});
    const bucket = categoryMap.get(category);
    const value = valueTransform(row[measureKey]);
    if (aggregate === "set") {
      bucket[segment] = value;
    } else {
      bucket[segment] = (bucket[segment] ?? 0) + value;
    }
  }

  const ranked = rankPivotStackedCategories(
    [...categoryMap.entries()].map(([key, segments]) => ({
      key,
      total: Object.values(segments).reduce((sum, value) => sum + value, 0),
      segments,
    })),
    { sortBy, sortBySegment }
  ).slice(0, maxCategories);

  return {
    categories: ranked.map((entry) => categoryLabel(entry.key)),
    series: segmentDefs.map((def) => ({
      name: def.label,
      data: ranked.map((entry) => entry.segments[def.key] ?? 0),
    })),
    colors: segmentDefs.map((def) => def.color),
  };
}

export function parseResolutionDwellStackedChart(result, { maxCategories = 5 } = {}) {
  return parsePivotStackedChart(result, {
    categoryKey: "service_code",
    segmentKey: "status",
    segmentDefs: RESOLUTION_DWELL_STACKED_SERIES,
    categoryLabel: formatDimensionLabel,
    maxCategories,
    measureKey: "avg_dwell",
    valueTransform: msToStackedHours,
    aggregate: "set",
    segmentFilter: (status) => RESOLUTION_DWELL_STATUS_KEYS.has(status),
  });
}

const OFFICER_OPEN_SLA_BUCKETS = new Set(["within", "approaching", "breached"]);

export function parseOfficerSlaStackedChart(result, { maxCategories = 8 } = {}) {
  return parsePivotStackedChart(result, {
    categoryKey: "current_assignee_uuid",
    segmentKey: "sla_status_bucket",
    segmentDefs: SLA_STACKED_SERIES,
    categoryLabel: formatOfficerStackedLabel,
    maxCategories,
    segmentKeyNormalize: (value) => String(value ?? "").toLowerCase(),
    segmentFilter: (segment) => OFFICER_OPEN_SLA_BUCKETS.has(segment),
    sortBySegment: "breached",
  });
}

export function parseOpenComplaintsByTypeStackedChart(result, { maxCategories = 8 } = {}) {
  return parsePivotStackedChart(result, {
    categoryKey: "service_code",
    segmentKey: "application_status",
    segmentDefs: OPEN_COMPLAINT_WORKFLOW_SERIES,
    categoryLabel: formatDimensionLabel,
    maxCategories,
    segmentKeyNormalize: (value) => String(value ?? "").toUpperCase(),
    segmentFilter: (segment) => OPEN_COMPLAINT_WORKFLOW_STAGE_KEYS.has(segment),
    sortBy: "total",
  });
}

export function parseStatusWeekStackedChart(result, { maxWeeks = 4 } = {}) {
  if (!result?.rows?.length) {
    return { categories: [], series: [], colors: STATUS_STACKED_SERIES.map((def) => def.color) };
  }

  const weekMap = new Map();
  for (const row of result.rows) {
    const week = String(row.created_week_start ?? "");
    const status = String(row.application_status ?? "Unknown").toUpperCase();
    if (!week) continue;
    if (!weekMap.has(week)) weekMap.set(week, {});
    const bucket = weekMap.get(week);
    bucket[status] = (bucket[status] ?? 0) + (Number(row.total) || 0);
  }

  const weeks = [...weekMap.entries()]
    .sort(([a], [b]) => String(a).localeCompare(String(b)))
    .slice(-maxWeeks);

  return {
    categories: weeks.map(([week]) => formatWeekStackedLabel(week)),
    series: STATUS_STACKED_SERIES.map((def) => ({
      name: def.label,
      data: weeks.map(([, segments]) => segments[def.key] ?? 0),
    })),
    colors: STATUS_STACKED_SERIES.map((def) => def.color),
  };
}

export function parseDowChart(result) {
  if (!result?.rows?.length) return [];
  return result.rows.map((row) => {
    const dow = Number(row.created_dow);
    return {
      label: DOW_LABELS[dow] ?? String(row.created_dow),
      count: Number(row.total) || 0,
    };
  });
}

export function parseRankedList(result, labelKey, limit = 5) {
  if (!result?.rows?.length) return [];
  return sortRowsByTotalDesc(result.rows, labelKey)
    .slice(0, limit)
    .map((row, index) => ({
      rank: index + 1,
      label: String(row[labelKey] ?? "Unknown"),
      value: Number(row.total) || 0,
    }));
}

function formatStatusLabel(status) {
  return String(status)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function computeWowPercent(current, prior) {
  if (prior == null || !Number.isFinite(prior)) return null;
  if (prior === 0) return current > 0 ? 100 : 0;
  return ((current - prior) / prior) * 100;
}

export function parseTrendingComplaintsTable(
  currentResult,
  priorResult,
  labelKey = "service_code",
  limit = 5,
  { enableWow = true, wowFallbackResult = null } = {}
) {
  if (!currentResult?.rows?.length) return [];

  const priorByKey = enableWow
    ? buildPriorVolumeByKey(priorResult, wowFallbackResult, labelKey)
    : null;

  return sortRowsByTotalDesc(currentResult.rows, labelKey)
    .slice(0, limit)
    .map((row, index) => {
      const key = String(row[labelKey] ?? "Unknown");
      const volume = Number(row.total) || 0;
      const label = formatDimensionLabel(key);
      const priorVolume = priorByKey?.[key] ?? 0;
      return {
        id: `trend-${index + 1}-${key}`,
        rank: index + 1,
        label,
        volume,
        wow: enableWow ? computeWowPercent(volume, priorVolume) : null,
      };
    });
}

export function parseResolutionByTypeTable(result, limit = 5) {
  if (!result?.rows?.length) return [];
  return result.rows.slice(0, limit).map((row, index) => {
    const key = String(row.service_code ?? "Unknown");
    return {
      id: `resolution-${index}-${key}`,
      label: formatDimensionLabel(key),
      closurePct: Number(row.closure_pct),
      ontimePct: Number(row.ontime_pct),
      avgTtrMs: Number(row.avg_ttr_ms),
    };
  });
}

export function parseComplaintTypeDetailsTable(result, limit = 30) {
  if (!result?.rows?.length) return [];

  return result.rows.slice(0, limit).map((row, index) => {
    const subtypeKey = String(row.service_code ?? "Unknown");
    const typeKey = String(row.service_group ?? "").trim();
    const avgResolutionMs = Number(row.avg_resolution_ms);
    const idealSlaMs = Number(row.ideal_sla_ms);

    return {
      id: `type-details-${index}-${subtypeKey}`,
      subtypeLabel: formatDimensionLabel(subtypeKey),
      typeLabel: typeKey ? formatDimensionLabel(typeKey) : "—",
      avgResolutionMs: Number.isFinite(avgResolutionMs) ? avgResolutionMs : null,
      idealSlaMs: Number.isFinite(idealSlaMs) ? idealSlaMs : null,
      reopenRate: Number(row.reopen_rate),
      oldestOpenMs: Number.isFinite(Number(row.oldest_open_ms))
        ? Number(row.oldest_open_ms)
        : null,
      ontimeRate: Number(row.ontime_rate),
      avgCsat: Number.isFinite(Number(row.avg_csat)) ? Number(row.avg_csat) : null,
    };
  });
}

export function parseLocalityTable(loggedResult, openResult, ontimeResult, limit = 5) {
  if (!loggedResult?.rows?.length) return [];

  const openByWard = Object.fromEntries(
    (openResult?.rows || []).map((row) => [
      String(row.ward_code),
      Number(row.total) || 0,
    ])
  );
  const ontimeByWard = Object.fromEntries(
    (ontimeResult?.rows || []).map((row) => [
      String(row.ward_code),
      Number(row.ontime_pct),
    ])
  );

  return sortRowsByTotalDesc(loggedResult.rows, "ward_code")
    .slice(0, limit)
    .map((row, index) => {
      const ward = String(row.ward_code ?? "Unknown");
      return {
        id: `ward-${index}-${ward}`,
        label: formatDimensionLabel(ward),
        logged: Number(row.total) || 0,
        open: openByWard[ward] ?? 0,
        ontimePct: ontimeByWard[ward],
      };
    });
}

function formatWorkflowStageLabel(status) {
  const key = String(status ?? "").toUpperCase();
  const labels = {
    PENDINGFORASSIGNMENT: "Pending Assignment",
    PENDINGATLME: "Assigned",
    PENDINGFORREASSIGNMENT: "Pending Reassignment",
    PENDINGATSUPERVISOR: "Pending at Supervisor",
    RESOLVED: "Resolved (end-to-end)",
    REJECTED: "Rejected",
    CLOSEDAFTERRESOLUTION: "Closed after resolution",
    CLOSEDAFTERREJECTION: "Closed after rejection",
  };
  if (labels[key]) return labels[key];
  return formatStatusLabel(status);
}

export function parseWorkflowStageTable(result, limit = 5) {
  if (result?.error || !result?.rows?.length) return [];

  return result.rows.slice(0, limit).map((row, index) => {
    const label = formatWorkflowStageLabel(row.status);
    return {
      id: `stage-${index}-${label}`,
      label,
      avgDwellMs: Number(row.avg_dwell),
      medianDwellMs: Number(row.median_dwell),
      samples: Number(row.samples) || 0,
    };
  });
}

export function parseDowTable(result) {
  if (!result?.rows?.length) return [];
  return result.rows.map((row, index) => {
    const dow = Number(row.created_dow);
    const label = DOW_LABELS[dow] ?? String(row.created_dow);
    return {
      id: `dow-${index}-${dow}`,
      label,
      count: Number(row.total) || 0,
    };
  });
}
