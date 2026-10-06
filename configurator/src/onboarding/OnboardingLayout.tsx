import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Check, ChevronRight, LayoutGrid, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useApp } from '../App';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useMastersCapability } from '@/hooks/useMastersCapability';
import { ONBOARDING_GATE_ENABLED } from '@/config/featureFlags';
import { NavRow, SectionLabel, RailBackdrop, RailCloseButton, RailMenuButton, RailPoweredBy } from '@/components/layout/rail';
import { railClasses } from '@/components/layout/railStyles';
import { useRailDrawer } from '@/components/layout/useRailDrawer';
import { AccountMenu, HelpButton, ThemeSwitcher } from '@/components/layout/HeaderControls';
import { ONBOARDING_STEPS } from './steps';
import { completedCount, resumePath, stepForPath, stepStatus, type StepStatus } from './progress';
import { initialsOf, useOrganisation } from './organisation';
import { trackEvent } from '@/lib/telemetry';

/**
 * The step marks in place of icons: a tick once a step is done, a filled dot
 * on the one to do now, a hollow ring on those still locked behind it.
 */
function StepMark({ status }: { status: StepStatus }) {
  if (status === 'done') {
    return (
      <span className="w-4 h-4 rounded-full bg-primary text-primary-foreground flex items-center justify-center flex-shrink-0">
        <Check className="w-2.5 h-2.5" strokeWidth={3.5} />
      </span>
    );
  }
  if (status === 'in-progress') {
    return (
      <span className="w-4 h-4 rounded-full border-2 border-primary flex items-center justify-center flex-shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-primary" />
      </span>
    );
  }
  return <span className="w-4 h-4 rounded-full border-2 border-muted-foreground/40 flex-shrink-0" />;
}

const STATUS_WORD: Record<StepStatus, string> = { done: 'done', 'in-progress': 'to do', locked: 'locked' };

export default function OnboardingLayout() {
  const { state, logout, setMode, toggleHelp } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const { canEditResource } = useMastersCapability();
  const drawer = useRailDrawer();
  const [collapsed, setCollapsed] = useState(false);
  const organisation = useOrganisation(state.tenant);
  const orgName = organisation.name;

  const completed = state.completedPhases;
  const done = completedCount(completed);
  const total = ONBOARDING_STEPS.length;
  const currentStep = stepForPath(location.pathname);
  // Steps unlock in order, so a typed or stale URL to a locked one resumes instead.
  const currentStepLocked = !!currentStep && stepStatus(currentStep, completed) === 'locked';
  // A view-only role learns up front that it can look but not create, rather
  // than from a failed submit deep in the step.
  const currentStepEditable = !currentStep || canEditResource(currentStep.master);
  const groups = [...new Set(ONBOARDING_STEPS.map((step) => step.group))];

  // A step opened, from the rail, a Back or continue, or a resume.
  const openedStep = currentStepLocked ? undefined : currentStep;
  useEffect(() => {
    if (openedStep) trackEvent('phase_start', { phase: openedStep.number, step: openedStep.id, tenant: state.tenant });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per step opened, not per tenant re-render
  }, [openedStep?.id]);

  const handleLogout = async () => {
    try { await logout(); navigate('/login'); }
    catch (error) { window.alert(error instanceof Error ? error.message : 'Sign-out failed. Please retry.'); }
  };

  const handleGoToManagement = () => {
    setMode('management');
    navigate('/manage');
  };

  const openMobileNav = () => {
    setCollapsed(false);
    drawer.openDrawer();
  };

  return (
    <div className="h-screen overflow-hidden bg-background flex">
      <RailBackdrop open={drawer.open} onClose={drawer.closeDrawer} />

      <aside className={railClasses(collapsed, drawer.open)}>
        {/* Organisation, collapse toggle and progress */}
        <div className="border-b border-border p-3 space-y-4">
          <div className={`flex items-center min-h-9 ${collapsed ? 'justify-center' : 'gap-2.5'}`}>
            {!collapsed && (
              <>
                <div className="w-7 h-7 rounded bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center flex-shrink-0 overflow-hidden">
                  {organisation.logoUrl ? (
                    <img src={organisation.logoUrl} alt="" className="w-full h-full object-contain bg-card" />
                  ) : (
                    initialsOf(orgName)
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold leading-5 text-foreground truncate" title={orgName}>{orgName}</p>
                  <p className="text-xs leading-4 text-muted-foreground truncate">Complaints Management</p>
                </div>
              </>
            )}
            <RailCloseButton label="Close menu" onClick={drawer.closeDrawer} />
            <button
              type="button"
              onClick={() => setCollapsed((value) => !value)}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="hidden md:inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-secondary hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
            </button>
          </div>

          {!collapsed && (
            <button
              type="button"
              onClick={() => navigate(resumePath(completed))}
              className="w-full text-left rounded border border-border bg-card p-3 transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-foreground">Let's set up your organisation</span>
                <ChevronRight aria-hidden="true" className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              </span>
              <span
                role="progressbar"
                aria-label="Setup progress"
                aria-valuemin={0}
                aria-valuemax={total}
                aria-valuenow={done}
                className="mt-2.5 block h-1.5 rounded-full bg-muted overflow-hidden"
              >
                <span className="block h-full rounded-full bg-primary transition-all" style={{ width: `${(done / total) * 100}%` }} />
              </span>
              <span className="mt-2 block text-xs text-muted-foreground">
                {done} of {total} completed
              </span>
            </button>
          )}
        </div>

        {/* Steps */}
        <nav aria-label="Setup steps" className="flex-1 py-2 overflow-y-auto">
          {groups.map((group) => (
            <div key={group} className="pb-4">
              {!collapsed && <SectionLabel>{group}</SectionLabel>}
              {ONBOARDING_STEPS.filter((step) => step.group === group).map((step) => {
                const status = stepStatus(step, completed);
                return (
                  <NavRow
                    key={step.id}
                    leading={<StepMark status={status} />}
                    label={step.label}
                    active={currentStep?.id === step.id}
                    collapsed={collapsed}
                    disabled={status === 'locked'}
                    onClick={() => navigate(step.path)}
                    trailing={<span className="sr-only">, {STATUS_WORD[status]}</span>}
                  />
                );
              })}
            </div>
          ))}
        </nav>

        {/* Footer: the way out while switching is allowed, then "Powered by DIGIT" */}
        {!ONBOARDING_GATE_ENABLED && (
          <div className="border-t border-border py-2">
            <NavRow icon={LayoutGrid} label="Go to Management" active={false} collapsed={collapsed} onClick={handleGoToManagement} />
          </div>
        )}
        <RailPoweredBy collapsed={collapsed} />
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-30 h-14 flex-shrink-0 bg-card border-b border-border pl-4 pr-4 sm:pr-6 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <RailMenuButton open={drawer.open} label="Open menu" onClick={openMobileNav} />
            <h1 className="text-base font-semibold text-foreground truncate">
              <span className="hidden sm:inline">Complaint Management System </span>Onboarding
            </h1>
          </div>
          <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
            <HelpButton label="Help" onClick={toggleHelp} />
            <ThemeSwitcher />
            <AccountMenu
              name={state.user?.name}
              tenant={state.tenant}
              accountLabel="Account"
              docsLabel="Open DIGIT Docs"
              signOutLabel="Sign out"
              onSignOut={handleLogout}
            />
          </div>
        </header>

        <main id="main-content" className="flex-1 overflow-auto min-h-0">
          <div className="max-w-6xl mx-auto p-4 sm:p-8">
            {!currentStepEditable && (
              <Alert className="mb-4">
                <AlertDescription>
                  Your role has view-only access to {currentStep?.label}. You can review this step, but creating or
                  editing records here is restricted to roles with write access (e.g. MDMS_ADMIN).
                </AlertDescription>
              </Alert>
            )}
            {currentStepLocked ? <Navigate to={resumePath(completed)} replace /> : <Outlet />}
          </div>
        </main>

      </div>
    </div>
  );
}
