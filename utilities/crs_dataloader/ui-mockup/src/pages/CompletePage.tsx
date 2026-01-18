import { useNavigate } from 'react-router-dom';
import { useApp } from '../App';
import { PartyPopper, Check, ExternalLink, RotateCcw, History, LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DigitCard } from '@/components/digit/DigitCard';
import { SubmitBar } from '@/components/digit/SubmitBar';

export default function CompletePage() {
  const { state, logout } = useApp();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const handleStartNew = () => {
    // In real app, would reset state
    navigate('/phase/1');
  };

  return (
    <div className="max-w-2xl mx-auto">
      <DigitCard>
        {/* Celebration - DIGIT style */}
        <div className="text-center">
          <div className="w-16 h-16 sm:w-24 sm:h-24 bg-primary rounded-full flex items-center justify-center mx-auto mb-4 sm:mb-6 shadow-lg">
            <PartyPopper className="w-8 h-8 sm:w-12 sm:h-12 text-primary-foreground" />
          </div>

          <h1 className="text-2xl sm:text-3xl font-condensed font-bold text-foreground mb-2">CRS Setup Complete!</h1>
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
              <p className="font-condensed font-semibold text-foreground text-sm sm:text-base">Tenant: <span className="text-primary">{state.tenant.toUpperCase()}</span></p>
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
                    <TableHead className="text-xs sm:text-sm font-condensed">Items Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="text-xs sm:text-sm">Phase 1: Tenant & Branding</TableCell>
                    <TableCell className="text-primary text-xs sm:text-sm font-medium">1 tenant, branding configured</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-xs sm:text-sm">Phase 2: Boundary Setup</TableCell>
                    <TableCell className="text-primary text-xs sm:text-sm font-medium">13 boundaries (ADMIN hierarchy)</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-xs sm:text-sm">Phase 3: Common Masters</TableCell>
                    <TableCell className="text-primary text-xs sm:text-sm font-medium">3 depts, 5 desigs, 5 complaint types</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="text-xs sm:text-sm">Phase 4: Employees</TableCell>
                    <TableCell className="text-primary text-xs sm:text-sm font-medium">4 employees with user accounts</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </div>
        </div>

        {/* What's next - DIGIT style */}
        <div className="p-4 bg-success/10 border border-success/20 rounded mb-6 sm:mb-8 text-left">
          <div className="flex items-center gap-2 text-success mb-2">
            <Check className="w-5 h-5" />
            <strong className="text-sm font-condensed">Your CRS/PGR system is ready!</strong>
          </div>
          <ul className="text-xs sm:text-sm space-y-1 sm:space-y-2 text-foreground">
            <li>• Employees can login to CRS application at <strong className="break-all text-primary">{state.environment.replace('https://', '')}</strong></li>
            <li>• Access complaint management based on their roles</li>
            <li>• Handle complaints in their assigned jurisdictions</li>
          </ul>
          <p className="mt-3 sm:mt-4 pt-3 border-t border-success/20 text-xs sm:text-sm">
            <strong>Default credentials:</strong> username / <code className="bg-muted px-1 rounded text-primary">eGov@123</code>
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
