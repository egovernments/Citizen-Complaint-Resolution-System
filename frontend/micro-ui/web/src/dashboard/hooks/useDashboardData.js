import { useCallback, useEffect, useState } from "react";
import {
  BATCH_QUERIES,
  LOADING_VALUE,
  buildAllSubMetricValues,
  parseBarChart,
  parseDowChart,
  parseRankedList,
} from "../config/kpiQueries";
import { hasAuth, runBatchQueries } from "../services/analyticsService";

const LOGIN_MESSAGE =
  "Log in at /digit-ui/employee/login to load live dashboard data.";

const TUNNEL_MESSAGE =
  "Start the analytics SSH tunnel: ssh -N -L 18280:127.0.0.1:18280 bomet — then restart npm start and refresh.";

function extractAsOf(results) {
  if (!results || typeof results !== "object") return null;
  const first = Object.values(results).find((entry) => entry?.asOf != null);
  return first?.asOf ?? null;
}

export function useDashboardData() {
  const [subMetricValues, setSubMetricValues] = useState({});
  const [chartData, setChartData] = useState({
    categories: [],
    wards: [],
    dow: [],
    rankedCategories: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [asOf, setAsOf] = useState(null);

  const fetchData = useCallback(async () => {
    if (!hasAuth()) {
      setSubMetricValues(buildAllSubMetricValues(null, false));
      setChartData({ categories: [], wards: [], dow: [], rankedCategories: [] });
      setAsOf(null);
      setError(LOGIN_MESSAGE);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    setSubMetricValues(buildAllSubMetricValues(null, true));

    try {
      const response = await runBatchQueries(BATCH_QUERIES);
      const results = response?.results ?? response;

      if (!results || typeof results !== "object") {
        throw new Error("Unexpected analytics response shape");
      }

      const categoryResult = results.cl_chart_categories;

      setSubMetricValues(buildAllSubMetricValues(results, false));
      setChartData({
        categories: parseBarChart(categoryResult, "service_code"),
        wards: parseBarChart(results.cl_chart_wards, "ward_code"),
        dow: parseDowChart(results.cl_chart_dow),
        rankedCategories: parseRankedList(categoryResult, "service_code", 5),
      });
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
      if (
        err?.status === 502 ||
        err?.status === 504 ||
        /Failed to fetch|NetworkError|ECONNREFUSED/i.test(message)
      ) {
        message = TUNNEL_MESSAGE;
      }

      setError(message);
      setSubMetricValues(buildAllSubMetricValues(null, false));
      setChartData({ categories: [], wards: [], dow: [], rankedCategories: [] });
      setAsOf(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    subMetricValues,
    chartData,
    loading,
    error,
    asOf,
    refetch: fetchData,
  };
}
