import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../App';
import { PartyPopper, Check, ExternalLink, RotateCcw, History, LogOut, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DigitCard } from '@/components/digit/DigitCard';
import { SubmitBar } from '@/components/digit/SubmitBar';
import { mdmsService, boundaryService, hrmsService } from '@/api';

interface TenantSummary {
  loading: boolean;
  error: string | null;
  departments: number;
  designations: number;
  complaintTypes: number;
  boundaries: number;
  employees: number;
}

const INITIAL_SUMMARY: TenantSummary = {
  loading: true,
  error: null,
  departments: 0,
  designations: 0,
  complaintTypes: 0,
  boundaries: 0,
  employees: 0,
};

export default function CompletePage() {
  const { state, logout } = useApp();
  const targetTenant = state.targetTenant || state.tenant;
  const navigate = useNavigate();
  const [summary, setSummary] = useState<TenantSummary>(INITIAL_SUMMARY);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Fetch in parallel; swallow per-resource errors so one broken
        // endpoint doesn't zero out the whole summary.
        const [departments, designations, complaintTypes, boundaries, employees] = await Promise.all([
          mdmsService.getDepartments(targetTenant).catch(() => [] as unknown[]),
          mdmsService.getDesignations(targetTenant).catch(() => [] as unknown[]),
          mdmsService.getComplaintTypes(targetTenant).catch(() => [] as unknown[]),
          boundaryService.searchBoundaries(targetTenant).catch(() => [] as unknown[]),
          hrmsService.searchEmployees(targetTenant).catch(() => [] as unknown[]),
        ]);
        if (cancelled) return;
        setSummary({
          loading: false,
          error: null,
          departments: departments.length,
          designations: designations.length,
          complaintTypes: complaintTypes.length,
          boundaries: boundaries.length,
          employees: employees.length,
        });
      } catch (err) {
        if (cancelled) return;
        setSummary((prev) => ({
          ...prev,
          loading: false,
          error: err instanceof Error ? err.message : 'Failed to load summary',
        }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [targetTenant]);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleStartNew = () => {
    // In real app, would reset state
    navigate('/phase/1');
  };

  // Render helper: "…" while loading, otherwise the count.
  const cell = (value: number, suffix: string) =>
    summary.loading ? (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <Loader2 className="w-3 h-3 animate-spin" /> loading
      </span>
    ) : (
      `${value} ${suffix}`
    );

  return (
    <div className="max-w-2xl mx-auto">
      <DigitCard>
        {/* Celebration - DIGIT style */}
        <div className="text-center">
          <div className="w-16 h-16 sm:w-24 sm:h-24 bg-primary rounded-full flex items-center justify-center mx-auto mb-4 sm:mb-6 shadow-lg">
            <PartyPopper className="w-8 h-8 sm:w-12 sm:h-12 text-primary-foreground" />
          </div>

          <h1 className="text-2xl sm:text-3xl font-condensed font-bold text-foreground mb-2">Setup Complete!</h1>
          <p className="text-base sm:text-lg text-muted-foreground mb-6 sm:mb-8">All phases completed successfully</p>

          {/* Progress summary - DIGIT style */}
          <div className="flex items-center justify-center gap-1 sm:gap-2 mb-6 sm:mb-8">
            {[1, 2, 3, 4].map((phase) => (
              <div key={phase} className="flex items-center gap-1 sm:gap-2">
                <div className="w-6 h-6 sm:w-8 sm:h-8 bg-primary rounded-full flex items-center justify-center">
                  <Check className="w-3 h-3 sm:w-4 sm:h-4 text-primary-foreground" />
                </div>
                {phase < 4 && <div className="w-4 sm:w-8 h-1 bg-primary rounded" />}
              </div>
            ))}
          </div>
        </div>

        {/* Summary card - DIGIT style */}
        <div className="bg-primary/5 border border-primary/20 rounded p-4 sm:p-6 mb-6 sm:mb-8 text-left">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 gap-2">
            <div>
              <p className="font-condensed font-semibold text-foreground text-sm sm:text-base">Tenant: <span className="text-primary">{targetTenant.toUpperCase()}</span></p>
              <p className="text-xs sm:text-sm text-muted-foreground truncate">Environment: {state.environment.replace('https://', '')}</p>
            </div>
            <a
              href={state.environment}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-primary hover:underline text-xs sm:text-sm font-medium"
            >
              Open DIGIT <ExternalLink className="w-3 h-3 sm:w-4 sm:h-4" />
            </a>
          </div>

          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <div className="min-w-[400px] sm:min-w-0 px-4 sm:px-0">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="text-xs sm:text-sm font-condensed">Phase</TableHead>
                    <TableHead className="text-xs sm:text-sm font-condensed">Records at tenant</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="text-xs sm:text-sm">Phase 1: Tenant & Branding</TableCell>
                    <TableCell className="text-primary text-xs sm:text-sm font-medium">{targetTenant}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-xs sm:text-sm">Phase 2: Boundary Setup</TableCell>
                    <TableCell className="text-primary text-xs sm:text-sm font-medium">{cell(summary.boundaries, 'boundaries')}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-xs sm:text-sm">Phase 3: Common Masters</TableCell>
                    <TableCell className="text-primary text-xs sm:text-sm font-medium">
                      {summary.loading ? (
                        <span className="inline-flex items-center gap-1 text-muted-foreground"><Loader2 className="w-3 h-3 animate-spin" /> loading</span>
                      ) : (
                        `${summary.departments} depts, ${summary.designations} desigs, ${summary.complaintTypes} complaint types`
                      )}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-xs sm:text-sm">Phase 4: Employees</TableCell>
                    <TableCell className="text-primary text-xs sm:text-sm font-medium">{cell(summary.employees, 'employees')}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
              {summary.error && (
                <p className="text-xs text-destructive mt-2">Failed to load counts: {summary.error}</p>
              )}
              <p className="text-[11px] text-muted-foreground mt-2">
                Counts reflect the current total at tenant <code>{targetTenant}</code> — including any data present from earlier setup sessions. To see only what this walk created, browse the Management UI and filter by code prefix.
              </p>
            </div>
          </div>
        </div>

        {/* What's next - DIGIT style */}
        <div className="p-4 bg-success/10 border border-success/20 rounded mb-6 sm:mb-8 text-left">
          <div className="flex items-center gap-2 text-success mb-2">
            <Check className="w-5 h-5" />
            <strong className="text-sm font-condensed">Your complaints management system is ready!</strong>
          </div>
          <ul className="text-xs sm:text-sm space-y-1 sm:space-y-2 text-foreground">
            <li>
              • Employees can login at{' '}
              <a
                href={`${state.environment}/digit-ui/employee/user/login`}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all text-primary underline hover:opacity-80"
              >
                {state.environment.replace(/^https?:\/\//, '')}/digit-ui/employee/user/login
              </a>
            </li>
            <li>
              • Citizens can file complaints at{' '}
              <a
                href={`${state.environment}/digit-ui/citizen`}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all text-primary underline hover:opacity-80"
              >
                {state.environment.replace(/^https?:\/\//, '')}/digit-ui/citizen
              </a>
            </li>
            <li>• Access complaint management based on their roles</li>
            <li>• Handle complaints in their assigned jurisdictions</li>
          </ul>
          <p className="mt-3 sm:mt-4 pt-3 border-t border-success/20 text-xs sm:text-sm">
            <strong>Default credentials:</strong> the employee's <em>code</em> (e.g. <code className="bg-muted px-1 rounded text-primary">TEST_EMP_001</code>) as username, password{' '}
            <code className="bg-muted px-1 rounded text-primary">eGov@123</code>. HRMS overrides the supplied <code className="bg-muted px-1 rounded">userName</code> with the employee code on create — that's the value that actually authenticates.
          </p>
        </div>

        {/* Actions - DIGIT style */}
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 justify-center">
          <Button variant="outline" size="sm" onClick={handleStartNew} className="border-primary text-primary hover:bg-primary/10">
            <RotateCcw className="w-4 h-4 mr-2" />
            Start New Setup
          </Button>
          <Button variant="outline" size="sm" className="border-primary text-primary hover:bg-primary/10">
            <History className="w-4 h-4 mr-2" />
            View Setup History
          </Button>
          <SubmitBar
            label="Logout"
            onSubmit={handleLogout}
            icon={<LogOut className="w-4 h-4" />}
          />
        </div>
      </DigitCard>

      {/* Footer note */}
      <p className="text-center text-xs sm:text-sm text-muted-foreground mt-4 sm:mt-6">
        Session completed • All data has been saved to DIGIT
      </p>
    </div>
  );
}
