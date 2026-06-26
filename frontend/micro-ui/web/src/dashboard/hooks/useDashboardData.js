import { useCallback, useEffect, useState } from "react";
import {
  buildAllSubMetricValues,
  buildBatchQueries,
  parseBarChart,
  parseComplaintsByTypeStackedChart,
  parseComplaintsAtRiskTable,
  parseComplaintTypeDetailsTable,
  parseComplaintsOverTimeChart,
  parseDepartmentsBarChart,
  parseDepartmentFlowRatioBarChart,
  parseDepartmentResolutionRateBarChart,
  parseEmployeePerformanceTable,
  parseDowChart,
  parseFilterOptions,
  parseGeographyMapLayers,
  parseComplaintMapPins,
  parseLocalityTable,
  parseOpenComplaintsByTypeStackedChart,
  parseOpenComplaintsByChannelPieChart,
  parseOpenComplaintsByAgeHistogram,
  parseOfficerSlaStackedChart,
  parseResolutionByTypeTable,
  parseResolutionDwellStackedChart,
  parseStatusWeekStackedChart,
  parseTrendingComplaintsTable,
  parseWorkflowStageTable,
} from "../config/kpiQueries";
import { annotateTableThresholds, TABLE_THRESHOLDS } from "../config/tablePresentation";
import { annotateComplaintTypeDetailsRows } from "../config/complaintTypeDetailsTablePresentation";
import { annotateEmployeePerformanceRows } from "../config/employeePerformanceTablePresentation";
import { COMPLAINT_TYPE_OPTIONS, GEOGRAPHY_OPTIONS } from "../config/globalFilterGroups";
import { hasAuth, runBatchQueries } from "../services/analyticsService";

const LOGIN_MESSAGE =
  "Log in at /digit-ui/employee/login to load live dashboard data.";

const TUNNEL_MESSAGE =
  "Set ANALYTICS_PROXY_URL and SSH-tunnel local port 18280 to your Kong gateway, then restart npm start and refresh.";

const ANALYTICS_NOT_DEPLOYED_MESSAGE =
  "Analytics API is not available on this pgr-services deployment yet. Redeploy pgr-services with the /v2/analytics endpoints, then refresh.";

const EMPTY_CHART_DATA = {
  categories: [],
  departments: [],
  departmentResolutionRates: [],
  departmentFlowRatios: [],
  wards: [],
  dow: [],
  statusWeekStacked: { categories: [], series: [], colors: [] },
  complaintsByTypeStacked: { categories: [], series: [], colors: [] },
  openByTypeStacked: { categories: [], series: [], colors: [] },
  openByChannel: [],
  complaintsByAge: [],
  officerSlaStacked: { categories: [], series: [], colors: [] },
  resolutionDwellStacked: { categories: [], series: [], colors: [] },
  trendingComplaints: [],
  resolutionByType: [],
  locality: [],
  workflowStages: [],
  complaintTypeDetails: [],
  employeePerformance: [],
  complaintsAtRisk: [],
  geographyMap: { wow_change: [], sla_breach: [], wardDetails: {}, complaintPins: [] },
  complaintsOverTime: null,
};

function extractAsOf(results) {
  if (!results || typeof results !== "object") return null;
  const first = Object.values(results).find((entry) => entry?.asOf != null);
  return first?.asOf ?? null;
}

function withTableThreshold(widgetId, rows) {
  return annotateTableThresholds(rows, TABLE_THRESHOLDS[widgetId]);
}

function buildChartData(results, dashboardFilters) {
  const categoryResult = results?.cl_chart_categories;

  return {
    categories: parseBarChart(categoryResult, "service_code"),
    departments: parseDepartmentsBarChart(results?.cl_chart_departments_by_type),
    departmentResolutionRates: parseDepartmentResolutionRateBarChart(
      results?.cl_chart_department_resolution_rate
    ),
    departmentFlowRatios: parseDepartmentFlowRatioBarChart(
      results?.cl_chart_department_resolution_rate
    ),
    wards: parseBarChart(results?.cl_chart_wards, "ward_code"),
    dow: parseDowChart(results?.cl_chart_dow),
    statusWeekStacked: parseStatusWeekStackedChart(results?.cl_chart_status_week),
    complaintsByTypeStacked: parseComplaintsByTypeStackedChart(
      results?.cl_chart_complaints_by_type
    ),
    openByTypeStacked: parseOpenComplaintsByTypeStackedChart(
      results?.cl_chart_open_by_type_stage
    ),
    openByChannel: parseOpenComplaintsByChannelPieChart(results?.cl_chart_open_by_channel),
    complaintsByAge: parseOpenComplaintsByAgeHistogram(results?.cl_chart_open_by_age),
    officerSlaStacked: parseOfficerSlaStackedChart(results?.cl_chart_officer_sla),
    resolutionDwellStacked: parseResolutionDwellStackedChart(
      results?.ev_chart_resolution_dwell_subtype
    ),
    complaintsOverTime: parseComplaintsOverTimeChart(results, dashboardFilters),
    trendingComplaints: parseTrendingComplaintsTable(
      categoryResult,
      results?.cl_chart_categories_pw,
      "service_code",
      5,
      {
        enableWow: true,
        wowFallbackResult: results?.cl_trending_wow,
      }
    ),
    resolutionByType: withTableThreshold(
      "cl-table-resolution",
      parseResolutionByTypeTable(results?.rs_table_resolution_by_category)
    ),
    locality: withTableThreshold(
      "cl-table-locality",
      parseLocalityTable(
        results?.cl_chart_wards,
        results?.cl_ward_open,
        results?.cl_ward_ontime
      )
    ),
    workflowStages: withTableThreshold(
      "cl-table-workflow-stages",
      parseWorkflowStageTable(results?.ev_table_stage_dwell)
    ),
    complaintTypeDetails: annotateComplaintTypeDetailsRows(
      parseComplaintTypeDetailsTable(results?.cl_table_complaint_type_details)
    ),
    employeePerformance: annotateEmployeePerformanceRows(
      parseEmployeePerformanceTable(
        results?.ep_table_employee_performance,
        results?.ep_table_employee_performance_dept,
        results?.ep_table_employee_performance_escalations
      )
    ),
    complaintsAtRisk: parseComplaintsAtRiskTable(results?.cl_table_complaints_at_risk),
    geographyMap: {
      ...parseGeographyMapLayers(
        results?.cl_map_ward_wow_current,
        results?.cl_map_ward_wow_prior,
        results?.cl_map_ward_sla_breach,
        results?.cl_map_ward_open,
        results?.cl_map_ward_sla_buckets
      ),
      complaintPins: parseComplaintMapPins(results?.cl_map_complaint_pins),
    },
  };
}

const DEFAULT_FILTER_OPTIONS = {
  geography: GEOGRAPHY_OPTIONS,
  complaintType: COMPLAINT_TYPE_OPTIONS,
};

export function useDashboardData(filters) {
  const [subMetricValues, setSubMetricValues] = useState({});
  const [analyticsResults, setAnalyticsResults] = useState(null);
  const [chartData, setChartData] = useState(EMPTY_CHART_DATA);
  const [filterOptions, setFilterOptions] = useState(DEFAULT_FILTER_OPTIONS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [asOf, setAsOf] = useState(null);

  const fetchData = useCallback(async () => {
    if (!hasAuth()) {
      setSubMetricValues(buildAllSubMetricValues(null, false));
      setAnalyticsResults(null);
      setChartData(EMPTY_CHART_DATA);
      setAsOf(null);
      setError(LOGIN_MESSAGE);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setSubMetricValues(buildAllSubMetricValues(null, true));

    try {
      const response = await runBatchQueries(buildBatchQueries(filters));
      const results = response?.results ?? response;

      if (!results || typeof results !== "object") {
        throw new Error("Unexpected analytics response shape");
      }

      setSubMetricValues(buildAllSubMetricValues(results, false));
      setAnalyticsResults(results);
      setChartData(buildChartData(results, filters));
      setFilterOptions(parseFilterOptions(results));
      setAsOf(extractAsOf(results));
    } catch (err) {
      let message =
        err?.payload?.Errors?.[0]?.message ||
        err?.message ||
        "Failed to load dashboard data";

      if (err?.status === 401) {
        message =
          "Analytics API requires nginx basic auth. Use the SSH tunnel on port 18280 instead.";
      }
      if (/No static resource v2\/analytics/i.test(message)) {
        message = ANALYTICS_NOT_DEPLOYED_MESSAGE;
      }
      if (
        err?.status === 502 ||
        err?.status === 504 ||
        /Failed to fetch|NetworkError|ECONNREFUSED/i.test(message)
      ) {
        message = TUNNEL_MESSAGE;
      }

      setError(message);
      setSubMetricValues(buildAllSubMetricValues(null, false));
      setAnalyticsResults(null);
      setChartData(EMPTY_CHART_DATA);
      setFilterOptions(DEFAULT_FILTER_OPTIONS);
      setAsOf(null);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    subMetricValues,
    analyticsResults,
    chartData,
    filterOptions,
    loading,
    error,
    asOf,
    refetch: fetchData,
  };
}
