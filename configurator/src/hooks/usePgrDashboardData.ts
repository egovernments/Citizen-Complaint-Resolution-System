import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { digitClient } from '@/providers/bridge';

// ---------- Types -----------------------------------------------------------

interface TimeSeriesData {
  labels: string[];
  cumTotal: number[];
  cumAddressed: number[];
  bySource: Record<string, number[]>;
  open: number[];
  addressed: number[];
}

interface BreakdownRow {
  name: string;
  open: number;
  closed: number;
  total: number;
  avgResolution: number;
  completionRate: number;
}

export interface PgrStats {
  total: number;
  closed: number;
  completionRate: number;

  byStatus: Record<string, number>;
  bySource: Record<string, number>;
  byDepartment: Record<string, number>;
  topTypes: { name: string; count: number }[];

  timeSeries: TimeSeriesData;
  citizensSeries: { labels: string[]; counts: number[] };

  byBoundary: BreakdownRow[];
  byDeptTable: BreakdownRow[];
  byTypeTable: BreakdownRow[];
  byChannelTable: BreakdownRow[];
}

// ---------- MV response types -----------------------------------------------

interface MvKpi {
  total: number;
  closed: number;
  completion_rate: number;
  avg_resolution_days: number | null;
  unique_citizens: number;
}

interface MvMonthly {
  month_label: string;
  month_date: string;
  total: number;
  closed: number;
  open_count: number;
  unique_citizens: number;
}

interface MvMonthlySource {
  month_label: string;
  month_date: string;
  source: string;
  total: number;
}

interface MvDimension {
  dimension: string;
  dim_value: string;
  total: number;
  closed: number;
  open_count: number;
  avg_resolution_days: number | null;
  completion_rate: number;
}

interface MvDepartment {
  department: string;
  total: number;
  closed: number;
  open_count: number;
  avg_resolution_days: number | null;
  completion_rate: number;
}

interface DashboardResponse {
  kpi: MvKpi;
  monthly: MvMonthly[];
  monthly_source: MvMonthlySource[];
  dimensions: MvDimension[];
  departments: MvDepartment[];
  refreshed_at: string;
}

// ---------- Transform MV response → PgrStats --------------------------------

function transformResponse(data: DashboardResponse): PgrStats {
  const { kpi, monthly, monthly_source, dimensions, departments } = data;

  // Build dimension lookups
  const byStatusDims = dimensions.filter((d) => d.dimension === 'status');
  const bySourceDims = dimensions.filter((d) => d.dimension === 'source');
  const byTypeDims = dimensions.filter((d) => d.dimension === 'type');
  const byBoundaryDims = dimensions.filter((d) => d.dimension === 'boundary');

  // KPI maps
  const byStatus: Record<string, number> = {};
  for (const d of byStatusDims) byStatus[d.dim_value] = d.total;

  const bySource: Record<string, number> = {};
  for (const d of bySourceDims) bySource[d.dim_value] = d.total;

  // Top types (already sorted by total DESC from the API)
  const topTypes = byTypeDims.slice(0, 10).map((d) => ({ name: d.dim_value, count: d.total }));

  // Time series — monthly data is already sorted by month_date from the API
  const labels = monthly.map((m) => m.month_label);
  const openArr = monthly.map((m) => m.open_count);
  const addressedArr = monthly.map((m) => m.closed);
  const citizenCounts = monthly.map((m) => m.unique_citizens);

  // Cumulative sums
  const cumTotal: number[] = [];
  const cumAddressed: number[] = [];
  let runTotal = 0;
  let runClosed = 0;
  for (const m of monthly) {
    runTotal += m.total;
    runClosed += m.closed;
    cumTotal.push(runTotal);
    cumAddressed.push(runClosed);
  }

  // By-source time series — build a source → month_index → count map
  const allSources = [...new Set(monthly_source.map((ms) => ms.source))];
  const monthDateIndex = new Map(monthly.map((m, i) => [m.month_date, i]));
  const bySourceSeries: Record<string, number[]> = {};
  for (const src of allSources) {
    bySourceSeries[src] = new Array(labels.length).fill(0);
  }
  for (const ms of monthly_source) {
    const idx = monthDateIndex.get(ms.month_date);
    if (idx !== undefined && bySourceSeries[ms.source]) {
      bySourceSeries[ms.source][idx] = ms.total;
    }
  }

  // Breakdown tables
  const toBreakdown = (dims: MvDimension[]): BreakdownRow[] =>
    dims.map((d) => ({
      name: d.dim_value,
      open: d.open_count,
      closed: d.closed,
      total: d.total,
      avgResolution: d.avg_resolution_days ?? 0,
      completionRate: d.completion_rate,
    }));

  return {
    total: kpi.total,
    closed: kpi.closed,
    completionRate: kpi.completion_rate,
    byStatus,
    bySource,
    byDepartment: Object.fromEntries(departments.map((d) => [d.department, d.total])),
    topTypes,
    timeSeries: {
      labels,
      cumTotal,
      cumAddressed,
      bySource: bySourceSeries,
      open: openArr,
      addressed: addressedArr,
    },
    citizensSeries: { labels, counts: citizenCounts },
    byBoundary: toBreakdown(byBoundaryDims),
    byDeptTable: departments.map((d) => ({
      name: d.department,
      open: d.open_count,
      closed: d.closed,
      total: d.total,
      avgResolution: d.avg_resolution_days ?? 0,
      completionRate: d.completion_rate,
    })),
    byTypeTable: toBreakdown(byTypeDims),
    byChannelTable: toBreakdown(bySourceDims),
  };
}

// ---------- Date range presets -----------------------------------------------

export type DatePreset = 'all' | 'today' | 'yesterday' | 'week' | 'month' | '3months';

export interface DateRange {
  fromDate?: number; // epoch ms
  toDate?: number;   // epoch ms
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function dateRangeFromPreset(preset: DatePreset): DateRange {
  if (preset === 'all') return {};
  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = new Date(todayStart.getTime() + 86400000 - 1);

  switch (preset) {
    case 'today':
      return { fromDate: todayStart.getTime(), toDate: todayEnd.getTime() };
    case 'yesterday': {
      const yd = new Date(todayStart.getTime() - 86400000);
      return { fromDate: yd.getTime(), toDate: todayStart.getTime() - 1 };
    }
    case 'week': {
      const weekAgo = new Date(todayStart.getTime() - 7 * 86400000);
      return { fromDate: weekAgo.getTime(), toDate: todayEnd.getTime() };
    }
    case 'month': {
      const monthAgo = new Date(todayStart);
      monthAgo.setMonth(monthAgo.getMonth() - 1);
      return { fromDate: monthAgo.getTime(), toDate: todayEnd.getTime() };
    }
    case '3months': {
      const threeMonthsAgo = new Date(todayStart);
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
      return { fromDate: threeMonthsAgo.getTime(), toDate: todayEnd.getTime() };
    }
  }
}

// ---------- Hook ------------------------------------------------------------

export function usePgrDashboardData(dateRange?: DateRange): {
  stats: PgrStats | null;
  isLoading: boolean;
  error: unknown;
} {
  const tenantId = digitClient.stateTenantId;

  const { data, isPending, error } = useQuery<DashboardResponse>({
    queryKey: ['pgr-dashboard', tenantId, dateRange?.fromDate, dateRange?.toDate],
    queryFn: async () => {
      const params = new URLSearchParams({ tenantId: tenantId! });
      if (dateRange?.fromDate) params.set('fromDate', String(dateRange.fromDate));
      if (dateRange?.toDate) params.set('toDate', String(dateRange.toDate));
      const res = await fetch(`/pgr-services/v2/dashboard?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      return res.json();
    },
    enabled: !!tenantId,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
  });

  const stats = useMemo<PgrStats | null>(() => {
    if (!data || data.kpi.total === 0) return null;
    return transformResponse(data);
  }, [data]);

  return {
    stats,
    isLoading: isPending,
    error,
  };
}
