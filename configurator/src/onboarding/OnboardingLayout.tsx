import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Check, ChevronRight, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useApp } from '../App';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useMastersCapability } from '@/hooks/useMastersCapability';
import { NavRow, SectionLabel, RailBackdrop, RailCloseButton, RailMenuButton, RailPoweredBy } from '@/components/layout/rail';
import { railClasses } from '@/components/layout/railStyles';
import { useRailDrawer } from '@/components/layout/useRailDrawer';
import { AccountMenu, HelpButton, LocaleSwitcher, ThemeSwitcher } from '@/components/layout/HeaderControls';
import { ONBOARDING_STEPS } from './steps';
import { completedCount, resumePath, stepForPath, stepStatus, type StepStatus } from './progress';
import { initialsOf, useOrganisation } from './organisation';
import { trackEvent } from '@/lib/telemetry';
import { useOnboardingT } from './i18n';

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


export default function OnboardingLayout() {
  const { state, logout, toggleHelp } = useApp();
  const t = useOnboardingT();
  const statusWord: Record<StepStatus, string> = {
    done: t('layout.status.done', 'done'),
    'in-progress': t('layout.status.to_do', 'to do'),
    locked: t('layout.status.locked', 'locked'),
  };
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
    catch (error) { window.alert(error instanceof Error ? error.message : t('layout.sign_out_failed', 'Sign-out failed. Please retry.')); }
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
                  <p className="text-xs leading-4 text-muted-foreground truncate">{t('app.header.brand', 'Complaints Management')}</p>
                </div>
              </>
            )}
            <RailCloseButton label={t('app.nav.close_menu', 'Close menu')} onClick={drawer.closeDrawer} />
            <button
              type="button"
              onClick={() => setCollapsed((value) => !value)}
              aria-label={collapsed ? t('app.nav.expand_sidebar', 'Expand sidebar') : t('app.nav.collapse_sidebar', 'Collapse sidebar')}
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
                <span className="text-sm font-semibold text-foreground">{t('layout.setup_title', 'Let’s set up your organisation')}</span>
                <ChevronRight aria-hidden="true" className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              </span>
              <span
                role="progressbar"
                aria-label={t('layout.setup_progress', 'Setup progress')}
                aria-valuemin={0}
                aria-valuemax={total}
                aria-valuenow={done}
                className="mt-2.5 block h-1.5 rounded-full bg-muted overflow-hidden"
              >
                <span className="block h-full rounded-full bg-primary transition-all" style={{ width: `${(done / total) * 100}%` }} />
              </span>
              <span className="mt-2 block text-xs text-muted-foreground">
                {t('layout.completed_count', '%{done} of %{total} completed', { done, total })}
              </span>
            </button>
          )}
        </div>

        {/* Steps */}
        <nav aria-label={t('layout.setup_steps', 'Setup steps')} className="flex-1 py-2 overflow-y-auto">
          {groups.map((group) => (
            <div key={group} className="pb-4">
              {!collapsed && <SectionLabel>{t(`groups.${group.toLowerCase()}`, group)}</SectionLabel>}
              {ONBOARDING_STEPS.filter((step) => step.group === group).map((step) => {
                const status = stepStatus(step, completed);
                return (
                  <NavRow
                    key={step.id}
                    leading={<StepMark status={status} />}
                    label={t(`steps.${step.id}`, step.label)}
                    active={currentStep?.id === step.id}
                    collapsed={collapsed}
                    disabled={status === 'locked'}
                    onClick={() => navigate(step.path)}
                    trailing={<span className="sr-only">, {statusWord[status]}</span>}
                  />
                );
              })}
            </div>
          ))}
        </nav>

        <RailPoweredBy collapsed={collapsed} />
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="sticky top-0 z-30 h-14 flex-shrink-0 bg-card border-b border-border pl-4 pr-4 sm:pr-6 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <RailMenuButton open={drawer.open} label={t('app.nav.open_menu', 'Open menu')} onClick={openMobileNav} />
            <h1 className="text-base font-semibold text-foreground truncate">
              <span className="hidden sm:inline">{t('layout.title_prefix', 'Complaint Management System')} </span>
              {t('layout.title', 'Onboarding')}
            </h1>
          </div>
          <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0">
            <HelpButton label={t('app.header.help', 'Help')} onClick={toggleHelp} />
            <LocaleSwitcher />
            <ThemeSwitcher />
            <AccountMenu
              name={state.user?.name}
              tenant={state.tenant}
              accountLabel={t('app.header.account', 'Account')}
              docsLabel={t('app.nav.open_digit_docs', 'Open DIGIT Docs')}
              signOutLabel={t('app.header.sign_out', 'Sign out')}
              onSignOut={handleLogout}
            />
          </div>
        </header>

        <main id="main-content" className="flex-1 overflow-auto min-h-0">
          <div className="max-w-6xl mx-auto p-4 sm:p-8">
            {!currentStepEditable && (
              <Alert className="mb-4">
                <AlertDescription>
                  {t(
                    'layout.view_only',
                    'Your role has view-only access to %{step}. You can review this step, but creating or editing records here is restricted to roles with write access (e.g. MDMS_ADMIN).',
                    { step: currentStep ? t(`steps.${currentStep.id}`, currentStep.label) : '' },
                  )}
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
