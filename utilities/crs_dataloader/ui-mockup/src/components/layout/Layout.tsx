import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useApp } from '../../App';
import {
  HelpCircle,
  LogOut,
  User,
  Building2,
  MapPin,
  FileSpreadsheet,
  Users,
  Check
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

const phases = [
  { id: 1, name: 'Tenant', fullName: 'Tenant & Branding', icon: Building2 },
  { id: 2, name: 'Boundary', fullName: 'Boundary Setup', icon: MapPin },
  { id: 3, name: 'Common', fullName: 'Common Masters', icon: FileSpreadsheet },
  { id: 4, name: 'Employee', fullName: 'Employee Onboarding', icon: Users },
];

export default function Layout() {
  const { state, logout, goToPhase, toggleHelp } = useApp();
  const navigate = useNavigate();
  const location = useLocation();

  const currentPhaseFromUrl = parseInt(location.pathname.split('/').pop() || '1');

  const handlePhaseClick = (phaseId: number) => {
    if (state.completedPhases.includes(phaseId) || phaseId <= state.currentPhase) {
      goToPhase(phaseId);
      navigate(`/phase/${phaseId}`);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const envName = state.environment.includes('unified-dev') ? 'unified-dev'
    : state.environment.includes('staging') ? 'staging'
    : state.environment.includes('uat') ? 'uat' : 'custom';

  return (
    <div className="min-h-screen bg-background">
      {/* Header - DIGIT style with orange accent */}
      <header className="bg-card sticky top-0 z-40 shadow-card">
        {/* Orange accent bar */}
        <div className="h-1 bg-primary" />
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14 sm:h-16">
            {/* Logo with orange accent */}
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="flex items-center">
                <div className="w-1 h-8 sm:h-10 bg-primary mr-2 sm:mr-3" />
                <div>
                  <span className="font-condensed font-bold text-foreground text-base sm:text-lg">CRS</span>
                  <span className="font-condensed font-medium text-muted-foreground text-base sm:text-lg ml-1">Data Loader</span>
                </div>
              </div>
            </div>

            {/* Right side */}
            <div className="flex items-center gap-2 sm:gap-4">
              {/* Environment badge */}
              <Badge variant="secondary" className="hidden xs:inline-flex text-xs bg-primary/10 text-primary border-primary/20">{envName}</Badge>

              {/* Help button */}
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleHelp}
                aria-label="Help (Ctrl+/ or F1)"
                title="Help (Ctrl+/ or F1)"
                className="h-8 w-8 sm:h-9 sm:w-9 text-muted-foreground hover:text-primary hover:bg-primary/10"
              >
                <HelpCircle className="w-4 h-4 sm:w-5 sm:h-5" />
              </Button>

              {/* User menu */}
              <div className="flex items-center gap-1.5 sm:gap-2 pl-2 sm:pl-4 border-l border-border">
                <div className="w-7 h-7 sm:w-8 sm:h-8 bg-primary/10 rounded-full flex items-center justify-center">
                  <User className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-primary" />
                </div>
                <div className="hidden sm:block">
                  <p className="text-sm font-medium text-foreground">{state.user?.name}</p>
                  <p className="text-xs text-muted-foreground">{state.tenant}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleLogout}
                  className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 h-8 w-8 sm:h-9 sm:w-9"
                  aria-label="Logout"
                >
                  <LogOut className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Progress Stepper - DIGIT style */}
      <div className="bg-card border-b border-border shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 sm:py-4">
          <nav aria-label="Progress">
            <ol className="flex items-center justify-between gap-1 sm:gap-2">
              {phases.map((phase, idx) => {
                const isCompleted = state.completedPhases.includes(phase.id);
                const isCurrent = currentPhaseFromUrl === phase.id;
                const isAccessible = isCompleted || phase.id <= state.currentPhase;
                const Icon = phase.icon;

                return (
                  <li key={phase.id} className="flex items-center flex-1 min-w-0">
                    <button
                      onClick={() => handlePhaseClick(phase.id)}
                      disabled={!isAccessible}
                      className={`
                        flex items-center gap-1 sm:gap-3 p-1.5 sm:p-2 rounded transition-all w-full
                        ${isAccessible ? 'cursor-pointer hover:bg-primary/5' : 'cursor-not-allowed opacity-50'}
                        ${isCurrent ? 'bg-primary/10' : ''}
                      `}
                      aria-current={isCurrent ? 'step' : undefined}
                      aria-label={`Phase ${phase.id}: ${phase.fullName}${isCompleted ? ', completed' : isCurrent ? ', current' : ''}`}
                    >
                      <div className={`
                        w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center flex-shrink-0 border-2
                        ${isCompleted ? 'bg-primary border-primary text-primary-foreground' : isCurrent ? 'bg-primary border-primary text-primary-foreground' : 'bg-card border-border text-muted-foreground'}
                      `}>
                        {isCompleted ? <Check className="w-4 h-4 sm:w-5 sm:h-5" /> : <Icon className="w-4 h-4 sm:w-5 sm:h-5" />}
                      </div>
                      <div className="hidden sm:block text-left min-w-0">
                        <p className={`text-sm font-condensed font-medium truncate ${isCurrent || isCompleted ? 'text-primary' : 'text-muted-foreground'}`}>
                          Phase {phase.id}
                        </p>
                        <p className={`text-xs truncate ${isCurrent ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                          {phase.name}
                        </p>
                      </div>
                    </button>
                    {idx < phases.length - 1 && (
                      <div className={`hidden xs:block w-4 sm:w-8 h-0.5 mx-0.5 sm:mx-1 flex-shrink-0 ${isCompleted ? 'bg-primary' : 'bg-border'}`} />
                    )}
                  </li>
                );
              })}
            </ol>
          </nav>
        </div>
      </div>

      {/* Main content */}
      <main id="main-content" className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-8">
        <Outlet />
      </main>

      {/* Footer - DIGIT style */}
      <footer className="bg-secondary text-white py-3 sm:py-4 mt-auto">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
          <p className="text-center text-xs sm:text-sm">
            CRS Data Loader • <span className="hidden sm:inline">Press <kbd className="px-1.5 py-0.5 bg-white/20 rounded text-xs">Ctrl+/</kbd> for help</span>
          </p>
        </div>
      </footer>
    </div>
  );
}
