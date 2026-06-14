import { useCallback, useEffect, useState } from "react";
import {
  buildAllSubMetricValues,
  buildBatchQueries,
  parseBarChart,
  parseDowChart,
  parseFilterOptions,
  parseLocalityTable,
  parseMapPins,
  parseResolutionByTypeTable,
  parseTrendingComplaintsTable,
  parseWorkflowStageTable,
} from "../config/kpiQueries";
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
  wards: [],
  dow: [],
  trendingComplaints: [],
  resolutionByType: [],
  locality: [],
  workflowStages: [],
  mapPins: [],
};

function extractAsOf(results) {
  if (!results || typeof results !== "object") return null;
  const first = Object.values(results).find((entry) => entry?.asOf != null);
  return first?.asOf ?? null;
}

function buildChartData(results, filters) {
  const useWow = !filters?.dateRangeActive;
  const categoryResult = results?.cl_chart_categories;

  return {
    categories: parseBarChart(categoryResult, "service_code"),
    wards: parseBarChart(results?.cl_chart_wards, "ward_code"),
    dow: parseDowChart(results?.cl_chart_dow),
    trendingComplaints: parseTrendingComplaintsTable(
      categoryResult,
      useWow ? results?.cl_chart_categories_pw : null
    ),
    resolutionByType: parseResolutionByTypeTable(
      results?.rs_table_resolution_by_category
    ),
    locality: parseLocalityTable(
      results?.cl_chart_wards,
      results?.cl_ward_open,
      results?.cl_ward_ontime
    ),
    workflowStages: parseWorkflowStageTable(results?.ev_table_stage_dwell),
    mapPins: parseMapPins(results?.cl_map_complaints),
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
