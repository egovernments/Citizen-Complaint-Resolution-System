import { useState, useMemo } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line, Bar, Doughnut } from 'react-chartjs-2';
import { Loader2 } from 'lucide-react';
import { DigitCard } from '@/components/digit/DigitCard';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { usePgrDashboardData, dateRangeFromPreset, type PgrStats, type DatePreset } from '@/hooks/usePgrDashboardData';
// Citizen UI fork: useWeeklyReport (operator Excel export) deliberately
// omitted — citizens don't generate weekly reports, and the hook pulled in
// a heavy `xlsx` dependency plus the ra-core bridge. Strip the Download
// Report UI block below in lockstep with this removal.

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

// -- Colors -----------------------------------------------------------------

const COLORS = {
  primary: '#F47738',
  primaryLight: '#FEEFE7',
  green: '#00703C',
  greenLight: '#e6f4ed',
  blue: '#1D70B8',
  blueLight: '#e8f1fa',
  red: '#D4351C',
  yellow: '#F9BE00',
  purple: '#7B2D8E',
  teal: '#00A5A8',
  grey: '#6B7280',
};

const PALETTE = [
  COLORS.primary, COLORS.blue, COLORS.green, COLORS.yellow,
  COLORS.purple, COLORS.teal, COLORS.red, COLORS.grey,
];

// -- Chart option presets ---------------------------------------------------

const baseLineOptions = {
  responsive: true,
  maintainAspectRatio: false,
  interaction: { intersect: false, mode: 'index' as const },
  plugins: {
    legend: { position: 'bottom' as const, labels: { usePointStyle: true, padding: 16, font: { size: 12 } } },
  },
  scales: {
    x: { grid: { display: false }, ticks: { font: { size: 11 } } },
    y: { grid: { color: '#f0f0f0' }, ticks: { font: { size: 11 } }, beginAtZero: true },
  },
};

const baseDoughnutOptions = {
  responsive: true,
  maintainAspectRatio: false,
  cutout: '65%',
  plugins: {
    legend: { position: 'right' as const, labels: { usePointStyle: true, padding: 12, font: { size: 11 } } },
  },
};

// -- Date filter presets ----------------------------------------------------

const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: 'all', label: 'All Time' },
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
  { value: '3months', label: '3 Months' },
];

// -- Components -------------------------------------------------------------

function ChartCard({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <DigitCard className={`!mb-0 !max-w-none ${className ?? ''}`}>
      <h3 className="text-sm font-semibold text-foreground mb-4">{title}</h3>
      {children}
    </DigitCard>
  );
}

function OverviewCard({ stats }: { stats: PgrStats }) {
  return (
    <DigitCard className="!mb-0 !max-w-none">
      <h3 className="text-sm font-semibold text-foreground mb-4">DSS Overview</h3>
      <div className="space-y-4">
        <div>
          <p className="text-sm text-muted-foreground">Total Complaints</p>
          <p className="text-3xl font-bold text-foreground">{stats.total.toLocaleString()}</p>
        </div>
        <div className="border-t pt-3">
          <p className="text-sm text-muted-foreground">Closed Complaints</p>
          <p className="text-3xl font-bold text-foreground">{stats.closed.toLocaleString()}</p>
        </div>
        <div className="border-t pt-3">
          <p className="text-sm text-muted-foreground">Completion Rate</p>
          <p className="text-3xl font-bold text-foreground">{stats.completionRate}%</p>
        </div>
      </div>
    </DigitCard>
  );
}

interface BreakdownRow {
  name: string;
  open: number;
  closed: number;
  total: number;
  avgResolution: number;
  completionRate: number;
}

function BreakdownTable({ rows }: { rows: BreakdownRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground py-4">No data available</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="py-2 pr-4 font-medium">#</th>
            <th className="py-2 pr-4 font-medium">Name</th>
            <th className="py-2 pr-4 font-medium text-right">Open</th>
            <th className="py-2 pr-4 font-medium text-right">Closed</th>
            <th className="py-2 pr-4 font-medium text-right">Total</th>
            <th className="py-2 pr-4 font-medium text-right">Avg Resolution (days)</th>
            <th className="py-2 font-medium text-right">Completion %</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.name} className="border-b last:border-0 hover:bg-muted/50">
              <td className="py-2 pr-4 text-muted-foreground">{i + 1}</td>
              <td className="py-2 pr-4 font-medium">{row.name}</td>
              <td className="py-2 pr-4 text-right">{row.open}</td>
              <td className="py-2 pr-4 text-right">{row.closed}</td>
              <td className="py-2 pr-4 text-right">{row.total}</td>
              <td className="py-2 pr-4 text-right">{row.avgResolution}</td>
              <td className="py-2 text-right">{row.completionRate}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// -- Main Dashboard ---------------------------------------------------------

export default function PgrDashboard() {
  const [datePreset, setDatePreset] = useState<DatePreset>('all');
  const dateRange = useMemo(() => dateRangeFromPreset(datePreset), [datePreset]);
  const { stats, isLoading, error } = usePgrDashboardData(dateRange);
  const [activeTab, setActiveTab] = useState('boundary');
  // Weekly-report state removed — operator-only export (see import comment).

  // Memoize chart data
  const cumulativeChart = useMemo(() => {
    if (!stats) return null;
    return {
      labels: stats.timeSeries.labels,
      datasets: [
        {
          label: 'Total',
          data: stats.timeSeries.cumTotal,
          borderColor: COLORS.primary,
          backgroundColor: COLORS.primaryLight,
          fill: true,
          tension: 0.3,
          pointRadius: 3,
        },
        {
          label: 'Addressed',
          data: stats.timeSeries.cumAddressed,
          borderColor: COLORS.green,
          backgroundColor: COLORS.greenLight,
          fill: true,
          tension: 0.3,
          pointRadius: 3,
        },
      ],
    };
  }, [stats]);

  const sourceChart = useMemo(() => {
    if (!stats) return null;
    const sources = Object.keys(stats.timeSeries.bySource);
    return {
      labels: stats.timeSeries.labels,
      datasets: sources.map((src, i) => ({
        label: src,
        data: stats.timeSeries.bySource[src],
        borderColor: PALETTE[i % PALETTE.length],
        backgroundColor: PALETTE[i % PALETTE.length],
        tension: 0.3,
        pointRadius: 2,
      })),
    };
  }, [stats]);

  const statusBarChart = useMemo(() => {
    if (!stats) return null;
    return {
      labels: stats.timeSeries.labels,
      datasets: [
        {
          label: 'Open',
          data: stats.timeSeries.open,
          backgroundColor: COLORS.yellow,
          borderRadius: 4,
        },
        {
          label: 'Addressed',
          data: stats.timeSeries.addressed,
          backgroundColor: COLORS.green,
          borderRadius: 4,
        },
      ],
    };
  }, [stats]);

  const statusDoughnutChart = useMemo(() => {
    if (!stats) return null;
    const entries = Object.entries(stats.byStatus);
    return {
      labels: entries.map(([k]) => k),
      datasets: [{
        data: entries.map(([, v]) => v),
        backgroundColor: entries.map((_, i) => PALETTE[i % PALETTE.length]),
        borderWidth: 0,
      }],
    };
  }, [stats]);

  const channelDoughnutChart = useMemo(() => {
    if (!stats) return null;
    const entries = Object.entries(stats.bySource);
    return {
      labels: entries.map(([k]) => k),
      datasets: [{
        data: entries.map(([, v]) => v),
        backgroundColor: entries.map((_, i) => PALETTE[i % PALETTE.length]),
        borderWidth: 0,
      }],
    };
  }, [stats]);

  const deptDoughnutChart = useMemo(() => {
    if (!stats) return null;
    const entries = Object.entries(stats.byDepartment);
    return {
      labels: entries.map(([k]) => k),
      datasets: [{
        data: entries.map(([, v]) => v),
        backgroundColor: entries.map((_, i) => PALETTE[i % PALETTE.length]),
        borderWidth: 0,
      }],
    };
  }, [stats]);

  const citizensChart = useMemo(() => {
    if (!stats) return null;
    return {
      labels: stats.citizensSeries.labels,
      datasets: [{
        label: 'Unique Citizens',
        data: stats.citizensSeries.counts,
        borderColor: COLORS.blue,
        backgroundColor: COLORS.blueLight,
        fill: true,
        tension: 0.3,
        pointRadius: 3,
      }],
    };
  }, [stats]);

  const topComplaintsChart = useMemo(() => {
    if (!stats) return null;
    return {
      labels: stats.topTypes.map((t) => t.name),
      datasets: [{
        label: 'Complaints',
        data: stats.topTypes.map((t) => t.count),
        backgroundColor: COLORS.primary,
        borderRadius: 4,
        barThickness: 18,
      }],
    };
  }, [stats]);

  // Loading skeleton
  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold font-condensed text-foreground">PGR Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Loading complaint data...</p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <DigitCard key={i} className="!mb-0 !max-w-none">
              <div className="animate-pulse space-y-3">
                <div className="h-4 bg-muted rounded w-1/3" />
                <div className="h-8 bg-muted rounded w-1/2" />
                <div className="h-4 bg-muted rounded w-1/3" />
                <div className="h-8 bg-muted rounded w-1/2" />
              </div>
            </DigitCard>
          ))}
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold font-condensed text-foreground">PGR Dashboard</h1>
        </div>
        <DigitCard className="!mb-0 !max-w-none">
          <p className="text-destructive">Failed to load complaint data. Please try again later.</p>
        </DigitCard>
      </div>
    );
  }

  // Empty state
  if (!stats) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold font-condensed text-foreground">PGR Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Public Grievance Redressal</p>
        </div>
        <DigitCard className="!mb-0 !max-w-none">
          <p className="text-muted-foreground">No complaints found. File a complaint to see dashboard data.</p>
        </DigitCard>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Title + Filters + Report Download */}
      <div className="space-y-3">
        <div className="flex items-start justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold font-condensed text-foreground">
              PGR Dashboard
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Public Grievance Redressal &mdash; {stats.total} complaint{stats.total !== 1 ? 's' : ''}
            </p>
          </div>
          {/* Download Report (operator-only Excel export) intentionally
              omitted from the citizen UI. */}
        </div>
        {/* Date filter presets */}
        <div className="flex items-center gap-1 flex-wrap">
          {DATE_PRESETS.map((p) => (
            <button
              key={p.value}
              onClick={() => setDatePreset(p.value)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                datePreset === p.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {p.label}
            </button>
          ))}
          {isLoading && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground ml-2" />}
        </div>
      </div>

      {/* Row 1: Overview card + Cumulative line chart */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <OverviewCard stats={stats} />
        <div className="lg:col-span-2">
          {cumulativeChart && (
            <ChartCard title="Cumulative Closed Complaints">
              <div className="h-[300px]">
                <Line data={cumulativeChart} options={baseLineOptions} />
              </div>
            </ChartCard>
          )}
        </div>
      </div>

      {/* Row 2: Source trend + Status bar */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {sourceChart && (
          <ChartCard title="Complaints by Source">
            <div className="h-[280px]">
              <Line data={sourceChart} options={baseLineOptions} />
            </div>
          </ChartCard>
        )}
        {statusBarChart && (
          <ChartCard title="Complaints Status">
            <div className="h-[280px]">
              <Bar
                data={statusBarChart}
                options={{
                  ...baseLineOptions,
                  scales: {
                    ...baseLineOptions.scales,
                    x: { ...baseLineOptions.scales.x, stacked: true },
                    y: { ...baseLineOptions.scales.y, stacked: true },
                  },
                }}
              />
            </div>
          </ChartCard>
        )}
      </div>

      {/* Row 3: Three doughnuts */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {statusDoughnutChart && (
          <ChartCard title="By Status">
            <div className="h-[220px]">
              <Doughnut data={statusDoughnutChart} options={baseDoughnutOptions} />
            </div>
          </ChartCard>
        )}
        {channelDoughnutChart && (
          <ChartCard title="By Channel">
            <div className="h-[220px]">
              <Doughnut data={channelDoughnutChart} options={baseDoughnutOptions} />
            </div>
          </ChartCard>
        )}
        {deptDoughnutChart && (
          <ChartCard title="By Department">
            <div className="h-[220px]">
              <Doughnut data={deptDoughnutChart} options={baseDoughnutOptions} />
            </div>
          </ChartCard>
        )}
      </div>

      {/* Row 4: Citizens + Top complaints */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {citizensChart && (
          <ChartCard title="Citizens">
            <div className="h-[280px]">
              <Line
                data={citizensChart}
                options={{
                  ...baseLineOptions,
                  plugins: { ...baseLineOptions.plugins, legend: { display: false } },
                }}
              />
            </div>
          </ChartCard>
        )}
        {topComplaintsChart && (
          <ChartCard title="Top Complaints">
            <div className="h-[280px]">
              <Bar
                data={topComplaintsChart}
                options={{
                  ...baseLineOptions,
                  indexAxis: 'y' as const,
                  plugins: { ...baseLineOptions.plugins, legend: { display: false } },
                  scales: {
                    x: { grid: { color: '#f0f0f0' }, ticks: { font: { size: 11 } }, beginAtZero: true },
                    y: { grid: { display: false }, ticks: { font: { size: 10 } } },
                  },
                }}
              />
            </div>
          </ChartCard>
        )}
      </div>

      {/* Row 5: Breakdown table with tabs */}
      <DigitCard className="!mb-0 !max-w-none">
        <h3 className="text-sm font-semibold text-foreground mb-4">Status by Tenant</h3>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="boundary">Boundary</TabsTrigger>
            <TabsTrigger value="department">Department</TabsTrigger>
            <TabsTrigger value="type">Complaint Type</TabsTrigger>
            <TabsTrigger value="channel">Channel</TabsTrigger>
          </TabsList>
          <TabsContent value="boundary">
            <BreakdownTable rows={stats.byBoundary} />
          </TabsContent>
          <TabsContent value="department">
            <BreakdownTable rows={stats.byDeptTable} />
          </TabsContent>
          <TabsContent value="type">
            <BreakdownTable rows={stats.byTypeTable} />
          </TabsContent>
          <TabsContent value="channel">
            <BreakdownTable rows={stats.byChannelTable} />
          </TabsContent>
        </Tabs>
      </DigitCard>
    </div>
  );
}
