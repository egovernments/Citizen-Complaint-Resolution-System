import AccountPage from '@/identity/AccountPage';
import MembersPage from '@/identity/MembersPage';
import WorkspacePage from '@/identity/WorkspacePage';
import { completedSteps, searchWorkspace, updateWorkspace, WORKSPACE_STEPS } from '@/identity/workspace';
import { describeStepCompletionError } from '@/onboarding/errors';
import { toast } from '@/hooks/use-toast';
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { useState, createContext, useContext, useEffect, useCallback } from 'react';
import OnboardingLayout from './onboarding/OnboardingLayout';
import ComplaintsStep from './onboarding/ComplaintsStep';
import BrandingStep from './onboarding/BrandingStep';
import GeographyStep from './onboarding/geography/GeographyStep';
import DepartmentsStep from './onboarding/departments/DepartmentsStep';
import EmployeesStep from './onboarding/employees/EmployeesStep';
import { ONBOARDING_STEPS } from './onboarding/steps';
import { finishesOnboarding, isOnboardingComplete, resumePath } from './onboarding/progress';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';
import RootLanding from './pages/RootLanding';
import { CoreAdminContext, CoreAdminUI, Resource, CustomRoutes } from 'ra-core';
import { QueryClient } from '@tanstack/react-query';
import { DigitLayout, DigitDashboard, MdmsResourcePage, MdmsResourceShow, MdmsResourceEdit, MdmsResourceCreate } from '@/admin';
import {
  DepartmentList, DepartmentShow, DepartmentEdit, DepartmentCreate, DepartmentBulkImport,
  DesignationList, DesignationShow, DesignationEdit, DesignationCreate, DesignationBulkImport,
  ComplaintTypeList, ComplaintTypeShow, ComplaintTypeEdit, ComplaintTypeCreate,
  TenantList, TenantShow, TenantEdit,
  EmployeeList, EmployeeShow, EmployeeEdit, EmployeeCreate, EmployeeBulkImport,
  ComplaintList, ComplaintShow, ComplaintEdit, ComplaintCreate,
  BoundaryList, BoundaryShow, BoundaryEdit, BoundaryCreate,
  LocalizationList, LocalizationShow, LocalizationEdit, LocalizationCreate, LocalizationBulkImport,
  UserList, UserShow, UserEdit, UserCreate,
  AccessRoleList, AccessRoleShow,
  AccessActionList, AccessActionShow,
  RoleActionList, RoleActionShow,
  WorkflowServiceList, WorkflowServiceShow,
  WorkflowProcessList, WorkflowProcessShow,
  MdmsSchemaList, MdmsSchemaShow,
  BoundaryHierarchyList, BoundaryHierarchyShow, BoundaryHierarchyCreate,
  ComplaintHierarchyList, ComplaintHierarchyShow, ComplaintHierarchyCreate,
  AdvancedPage,
} from '@/resources';
// Novu-into-configurator read-only screens. Imported directly (not via the
// @/resources barrel) so the notification surfaces stay self-contained.
import { NotificationLogList } from '@/resources/notification-logs/NotificationLogList';
import { NotificationProviderList } from '@/resources/notification-providers/NotificationProviderList';
import { NotificationChannelsPage } from '@/resources/notification-providers/NotificationChannelsPage';
import { NotificationPreferenceList } from '@/resources/notification-preferences/NotificationPreferenceList';
import { NotificationConfigure } from '@/resources/notification-configure/NotificationConfigure';
import { AnalyticsProvidersEditor } from '@/admin/analytics/AnalyticsProvidersEditor';
import PgrDashboard from './pages/PgrDashboard';
import OrgChartPage from './pages/org-chart/OrgChartPage';
import PublicDashboardConfigure from './resources/public-dashboard/PublicDashboardConfigure';
import { getGenericMdmsResources, getDataProvider, getAuthProvider, configureDigitClient, i18nProvider, DigitApiClient, isReadOnlyResource } from '@/providers/bridge';
import { MastersCapabilityProvider, useMastersCapability } from '@/hooks/useMastersCapability';
import { ThemeProvider } from '@/providers/ThemeProvider';
import HelpModal from './components/ui/HelpModal';
import { Toaster } from './components/ui/toaster';
import { apiClient, getApiBaseUrl, getConfiguredRootTenant } from './api';
import { identifyUser, trackEvent } from './lib/telemetry';
import { clearLocalSession, SESSION_EXPIRED_KEY, signOutThisDevice } from './lib/session';
import PageViewTracker from './components/PageViewTracker';
import './App.css';
import { LEGACY_PGR_DASHBOARD_ENABLED, ONBOARDING_GATE_ENABLED } from '@/config/featureFlags';

// App context for global state
type AppMode = 'onboarding' | 'management';

interface AppState {
  isAuthenticated: boolean;
  user: { name: string; email: string; roles: string[]; id?: number; uuid?: string; mobileNumber?: string } | null;
  environment: string;
  /** Session tenant — the tenant the authenticated user lives under. Stays
   *  put for the whole walk; used for auth, schema lookups, and any operation
   *  that has to happen at the state-root tenant. */
  tenant: string;
  /** Target tenant — the tenant that phases 2–4 write to and read from.
   *  Set by Phase 1 after a successful tenant create; defaults to the session
   *  tenant so anything that skips Phase 1 keeps today's behavior. */
  targetTenant: string;
  mode: AppMode;
  currentPhase: number;
  completedPhases: number[];
  undoStack: { id: string; action: string; description: string; timestamp: Date }[];
  showHelp: boolean;
}

interface AppContextType {
  state: AppState;
  login: (user: AppState['user'], env: string, tenant: string, mode: AppMode) => void;
  logout: () => Promise<void>;
  setMode: (mode: AppMode) => void;
  /** Point subsequent onboarding writes/reads at a child tenant. Called by
   *  Phase 1 after `tenant.tenants` create succeeds. */
  setTargetTenant: (code: string) => void;
  completePhase: (phase: number, skip?: boolean) => Promise<boolean>;
  goToPhase: (phase: number) => void;
  addUndo: (action: string, description: string) => void;
  undo: () => void;
  dismissUndo: (id: string) => void;
  toggleHelp: () => void;
}

const AppContext = createContext<AppContextType | null>(null);

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used within AppProvider');
  return context;
};

// react-admin query client (shared across ManagementAdmin mounts)
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5 * 60 * 1000 } },
});

function ManagementAdmin() {
  return (
    <MastersCapabilityProvider>
      <ManagementAdminResources />
    </MastersCapabilityProvider>
  );
}

// Split from ManagementAdmin so useMastersCapability() (which reads the
// context MastersCapabilityProvider establishes above) resolves correctly —
// see docs/reference/architecture/access-control/masters-configurator-access-policy-design.md §3.3. Masters
// the current role can't see are filtered out via `{cond && <Resource .../>}`
// (React.Children.toArray drops the resulting `false`), keeping every
// <Resource> a direct child of <CoreAdminUI> as react-admin requires.
function ManagementAdminResources() {
  const { state } = useApp();
  const { canViewResource } = useMastersCapability();
  return (
    <CoreAdminContext
      dataProvider={getDataProvider(state.tenant)}
      authProvider={getAuthProvider()}
      i18nProvider={i18nProvider}
      queryClient={queryClient}
      basename="/manage"
    >
      <CoreAdminUI layout={DigitLayout} dashboard={DigitDashboard}>
        {/* Core entities with List/Show/Edit/Create */}
        {canViewResource('tenants') && <Resource name="tenants" list={TenantList} show={TenantShow} edit={TenantEdit} />}
        {canViewResource('departments') && <Resource name="departments" list={DepartmentList} show={DepartmentShow} edit={DepartmentEdit} create={DepartmentCreate} />}
        {canViewResource('designations') && <Resource name="designations" list={DesignationList} show={DesignationShow} edit={DesignationEdit} create={DesignationCreate} />}
        {/* Complaint types are the LEAF rows of the single ComplaintHierarchy
            master (registry key 'complaint-hierarchy'); the data provider
            filters leaves and maps them to the legacy ServiceDefs shape so
            these dedicated views keep working unchanged. */}
        {canViewResource('complaint-hierarchy') && <Resource name="complaint-hierarchy" list={ComplaintTypeList} show={ComplaintTypeShow} edit={ComplaintTypeEdit} create={ComplaintTypeCreate} />}
        {canViewResource('employees') && <Resource name="employees" list={EmployeeList} show={EmployeeShow} edit={EmployeeEdit} create={EmployeeCreate} />}
        {canViewResource('complaints') && <Resource name="complaints" list={ComplaintList} show={ComplaintShow} edit={ComplaintEdit} create={ComplaintCreate} />}
        {canViewResource('boundaries') && <Resource name="boundaries" list={BoundaryList} show={BoundaryShow} edit={BoundaryEdit} create={BoundaryCreate} />}
        {canViewResource('localization') && <Resource name="localization" list={LocalizationList} show={LocalizationShow} edit={LocalizationEdit} create={LocalizationCreate} />}
        {canViewResource('users') && <Resource name="users" list={UserList} show={UserShow} edit={UserEdit} create={UserCreate} />}

        {/* Read-only entities with List/Show */}
        {canViewResource('access-roles') && <Resource name="access-roles" list={AccessRoleList} show={AccessRoleShow} />}
        {canViewResource('access-actions') && <Resource name="access-actions" list={AccessActionList} show={AccessActionShow} />}
        {canViewResource('role-actions') && <Resource name="role-actions" list={RoleActionList} show={RoleActionShow} />}
        {canViewResource('workflow-business-services') && <Resource name="workflow-business-services" list={WorkflowServiceList} show={WorkflowServiceShow} />}
        {canViewResource('workflow-processes') && <Resource name="workflow-processes" list={WorkflowProcessList} show={WorkflowProcessShow} />}
        {canViewResource('mdms-schemas') && <Resource name="mdms-schemas" list={MdmsSchemaList} show={MdmsSchemaShow} />}
        {canViewResource('boundary-hierarchies') && <Resource name="boundary-hierarchies" list={BoundaryHierarchyList} show={BoundaryHierarchyShow} create={BoundaryHierarchyCreate} />}
        {canViewResource('complaint-hierarchies') && <Resource name="complaint-hierarchies" list={ComplaintHierarchyList} show={ComplaintHierarchyShow} create={ComplaintHierarchyCreate} />}

        {/* Novu-into-configurator: read-only notification surfaces served by the
            novu-bridge proxy (not egov-mdms). Names match the 'custom' registry
            keys the data provider branches on. Routable at
            /manage/notification-log and /manage/notification-provider. */}
        {canViewResource('notification-log') && <Resource name="notification-log" list={NotificationLogList} />}
        {canViewResource('notification-provider') && <Resource name="notification-provider" list={NotificationProviderList} />}
        {canViewResource('notification-preference') && <Resource name="notification-preference" list={NotificationPreferenceList} />}

        {/* Generic MDMS with Show/Edit/Create (exclude resources with dedicated UI above).
            A `readOnly` master (the legacy RAINMAKER-PGR.Notification* four, whose
            configuration moved to NOTIFICATIONS.*, and the module-owned event catalogue)
            gets NO edit/create route at all — not merely a hidden button, so a
            hand-typed /manage/<name>/<id> URL lands on Show rather than a form whose
            Save would 403 or, worse, succeed. canEditResource already returns false for
            them, which removes the buttons. */}
        {Object.keys(getGenericMdmsResources()).filter((name) => name !== 'role-actions' && canViewResource(name)).map((name) => (
          isReadOnlyResource(name)
            ? <Resource key={name} name={name} list={MdmsResourcePage} show={MdmsResourceShow} />
            // Notifications → Channels: the channel card replaces the generic list, and
            // there is no Create — the three channels are a closed, seeded set (see
            // NotificationChannelsPage). Show/Edit stay for the legacy gateway fields.
            : name === 'notifications-channel'
              ? <Resource key={name} name={name} list={NotificationChannelsPage} show={MdmsResourceShow} edit={MdmsResourceEdit} />
              : <Resource key={name} name={name} list={MdmsResourcePage} show={MdmsResourceShow} edit={MdmsResourceEdit} create={MdmsResourceCreate} />
        ))}

        {/* Custom routes */}
        <CustomRoutes>
          <Route path="/notification-configure" element={<NotificationConfigure />} />
          {/* Analytics destinations. A CustomRoute rather than a <Resource>: the
              screen deliberately does not use react-admin's list/edit/delete
              machinery, because the generic MDMS mutation path is not scoped to
              the session tenant and would rewrite or deactivate rows owned by
              the parent tenant. */}
          <Route path="/analytics-providers" element={<AnalyticsProvidersEditor />} />
          <Route path="/advanced" element={<AdvancedPage />} />
          <Route
            path="/pgr-dashboard"
            element={LEGACY_PGR_DASHBOARD_ENABLED ? <PgrDashboard /> : <Navigate to="/manage" replace />}
          />
          <Route path="/public-dashboard" element={<PublicDashboardConfigure />} />
          <Route path="/org-chart" element={<OrgChartPage />} />
          <Route path="/employees/bulk" element={<EmployeeBulkImport />} />
          <Route path="/departments/bulk" element={<DepartmentBulkImport />} />
          <Route path="/designations/bulk" element={<DesignationBulkImport />} />
          <Route path="/localization/bulk" element={<LocalizationBulkImport />} />
        </CustomRoutes>
      </CoreAdminUI>
    </CoreAdminContext>
  );
}

// Storage key for persisting auth state. Defined with the teardown that
// clears it so the two cannot drift apart.
import { AUTH_STORAGE_KEY } from './lib/session';

// One-shot flag (sessionStorage) set when a request is rejected for an expired
// session, read by LoginPage to explain why the operator was sent back.

// Helper to restore apiClient from localStorage
function restoreApiClientFromStorage(): { isAuthenticated: boolean; user: AppState['user']; environment: string; tenant: string; targetTenant: string; mode: AppMode; currentPhase: number; completedPhases: number[] } | null {
  const saved = localStorage.getItem(AUTH_STORAGE_KEY);
  if (!saved) return null;

  try {
    const parsed = JSON.parse(saved);
    if (parsed.authToken && parsed.user) {
      apiClient.setEnvironment(parsed.environment);
      apiClient.setAuth(parsed.authToken, {
        id: parsed.user.id ?? 0,
        uuid: parsed.user.uuid ?? '',
        userName: parsed.user.name,
        name: parsed.user.name,
        mobileNumber: parsed.user.mobileNumber ?? '',
        type: 'EMPLOYEE',
        roles: parsed.user.roles?.map((r: string) => ({ code: r, name: r, tenantId: parsed.tenant })) || [],
        tenantId: parsed.tenant,
      });
      apiClient.setTenantId(parsed.tenant);

      // Also configure the shared digitClient from the bridge. If the stored
      // session lacks a tenant, bail — there's no sensible default (a stale
      // `'statea'` or `'pg'` fallback silently attached operators to the wrong
      // tenant and hid the real "re-login" needed).
      const restoredEnv = parsed.environment || getApiBaseUrl();
      const restoredTenant = parsed.tenant;
      if (!restoredTenant) return null;
      configureDigitClient(restoredEnv, parsed.authToken, {
        id: parsed.user.id ?? 0,
        uuid: parsed.user.uuid ?? '',
        userName: parsed.user.name,
        name: parsed.user.name,
        mobileNumber: parsed.user.mobileNumber ?? '',
        type: 'EMPLOYEE',
        roles: parsed.user.roles?.map((r: string) => ({ code: r, name: r, tenantId: restoredTenant })) || [],
        tenantId: restoredTenant,
      }, restoredTenant);

      return {
        isAuthenticated: true,
        user: parsed.user,
        environment: restoredEnv,
        tenant: restoredTenant,
        targetTenant: parsed.targetTenant || restoredTenant,
        mode: parsed.mode || 'onboarding',
        currentPhase: parsed.currentPhase || 1,
        completedPhases: parsed.completedPhases || [],
      };
    }
  } catch {
    // Invalid stored data
  }
  return null;
}

// Root (state-level) tenant the deployment is configured for, read from the
// build-time VITE_STATE_TENANT_ID (rendered by the ansible deploy from
// host_vars `state_tenant_id`). Used only as the pre-login default; once the
// operator logs in, `state.tenant` becomes the tenant they authenticated
// against. Kept config-driven so no country code is baked into the build.
// City tenants like "mz.maputo" collapse to their root segment; empty string
// when the build wasn't given one.
function getConfiguredTenantDefault(): string {
  return getConfiguredRootTenant();
}

function App() {
  // Initialize state from localStorage if available
  const [state, setState] = useState<AppState>(() => {
    const restored = restoreApiClientFromStorage();
    if (restored) {
      return {
        ...restored,
        undoStack: [],
        showHelp: false,
      };
    }
    const defaultTenant = getConfiguredTenantDefault();
    return {
      isAuthenticated: false,
      user: null,
      environment: getApiBaseUrl(),
      tenant: defaultTenant,
      targetTenant: defaultTenant,
      mode: 'onboarding',
      currentPhase: 1,
      completedPhases: [],
      undoStack: [],
      showHelp: false,
    };
  });

  // Drop the session and bounce to /login when any request reports the token
  // is no longer valid (e.g. it expired while the operator was partway through
  // a long flow like the Phase 2 OSM boundary fetch). Without this, an expired
  // token surfaces only on the first write, as a cryptic downstream NPE, with
  // the UI still pretending to be logged in.
  useEffect(() => {
    const expire = () => {
      try { sessionStorage.setItem(SESSION_EXPIRED_KEY, '1'); } catch { /* ignore */ }
      clearLocalSession();
      setState(s => ({ ...s, isAuthenticated: false, user: null }));
    };
    apiClient.setSessionExpiredHandler(expire);
    // Management lists (employees / complaints / access-roles) go through
    // digitClient, not apiClient — without this they show InvalidAccessTokenException
    // while MDMS cards keep working (those routes don't enforce the token).
    DigitApiClient.setSessionExpiredHandler(expire);
  }, []);

  // Re-sync apiClient on every render if authenticated (handles HMR)
  useEffect(() => {
    if (state.isAuthenticated && !apiClient.isAuthenticated()) {
      // apiClient got reset (HMR), restore from localStorage
      const restored = restoreApiClientFromStorage();
      if (!restored) {
        // localStorage is gone too, force logout
        setState(s => ({ ...s, isAuthenticated: false, user: null }));
      }
    }
  }, [state.isAuthenticated]);

  // Track session restoration and identify user on initial load
  useEffect(() => {
    if (state.isAuthenticated && state.user) {
      identifyUser({
        id: state.user.email || state.user.name,
        name: state.user.name,
        email: state.user.email,
        tenant: state.tenant,
        roles: state.user.roles,
      });
      trackEvent('session_restored', { tenant: state.tenant, mode: state.mode });
    }
  }, []); // Only run once on mount

  // Persist auth state to localStorage
  useEffect(() => {
    if (state.isAuthenticated && state.user) {
      const token = apiClient.getAuth().token;
      // Never persist a blank token over a good session (HMR can run this
      // before apiClient is restored and would log the operator out).
      if (!token) return;
      const authData = {
        isAuthenticated: state.isAuthenticated,
        user: state.user,
        environment: state.environment,
        tenant: state.tenant,
        targetTenant: state.targetTenant,
        mode: state.mode,
        currentPhase: state.currentPhase,
        completedPhases: state.completedPhases,
        authToken: token,
      };
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(authData));
    }
  }, [state.isAuthenticated, state.user, state.environment, state.tenant, state.targetTenant, state.mode, state.currentPhase, state.completedPhases]);

  const login = (user: AppState['user'], env: string, tenant: string, mode: AppMode) => {
    // Fresh login resets targetTenant to the session tenant. Phase 1 will
    // point it at a child tenant once a create succeeds.
    setState(s => ({ ...s, isAuthenticated: true, user, environment: env, tenant, targetTenant: tenant, mode }));

    // Configure digitClient with the same auth as apiClient
    const { token } = apiClient.getAuth();
    if (token && user) {
      configureDigitClient(env, token, {
        id: user.id ?? 0,
        uuid: user.uuid ?? '',
        userName: user.name,
        name: user.name,
        mobileNumber: user.mobileNumber ?? '',
        type: 'EMPLOYEE',
        roles: user.roles?.map(r => ({ code: r, name: r, tenantId: tenant })) || [],
        tenantId: tenant,
      }, tenant);
    }

    // Track user in telemetry
    if (user) {
      identifyUser({
        id: user.email || user.name,
        name: user.name,
        email: user.email,
        tenant,
        roles: user.roles,
      });
      trackEvent('login', { tenant, mode, environment: env });
    }
  };

  const setMode = (mode: AppMode) => {
    setState(s => ({ ...s, mode }));
    trackEvent('mode_switch', { mode });
  };

  const setTargetTenant = (code: string) => {
    setState(s => ({ ...s, targetTenant: code }));
    trackEvent('target_tenant_set', { targetTenant: code });
  };

  const logout = async () => {
    trackEvent('logout', { tenant: state.tenant });
    // Storage, both API clients and the cached providers first, then the BFF
    // session best-effort, so sign-out never fails closed.
    await signOutThisDevice();
    setState(s => ({ ...s, isAuthenticated: false, user: null, mode: 'onboarding', currentPhase: 1, completedPhases: [], targetTenant: s.tenant }));
  };

  const completePhase = async (phase: number, skip = false): Promise<boolean> => {
    try {
      const latest = await searchWorkspace(state.tenant);
      const updated = await updateWorkspace(state.tenant, WORKSPACE_STEPS[phase - 1], skip ? 'SKIPPED' : 'DONE', latest.Workspace.version);
      const completedPhases = completedSteps(updated.Workspace);
      setState(s => ({ ...s, completedPhases, currentPhase: Math.min(phase + 1, ONBOARDING_STEPS.length) }));
      const step = ONBOARDING_STEPS.find(candidate => candidate.number === phase);
      trackEvent('phase_complete', { phase, step: step?.id, tenant: state.tenant });
      if (finishesOnboarding(phase, state.completedPhases)) trackEvent('onboarding_complete', { tenant: state.tenant });
      return true;
    } catch (error) {
      toast({ variant: 'destructive', title: 'Could not complete setup step', description: describeStepCompletionError(error, WORKSPACE_STEPS[phase - 1]) });
      return false;
    }
  };

  const goToPhase = (phase: number) => {
    setState(s => ({ ...s, currentPhase: phase }));
    trackEvent('phase_start', { phase, tenant: state.tenant });
  };

  const addUndo = (action: string, description: string) => {
    const id = Date.now().toString();
    setState(s => ({
      ...s,
      undoStack: [{ id, action, description, timestamp: new Date() }, ...s.undoStack].slice(0, 5),
    }));
    // Auto-dismiss after 30 seconds
    setTimeout(() => {
      setState(s => ({ ...s, undoStack: s.undoStack.filter(u => u.id !== id) }));
    }, 30000);
  };

  const undo = () => {
    if (state.undoStack.length > 0) {
      // In real app, would reverse the action here
      setState(s => ({ ...s, undoStack: s.undoStack.slice(1) }));
    }
  };

  const dismissUndo = (id: string) => {
    setState(s => ({ ...s, undoStack: s.undoStack.filter(u => u.id !== id) }));
  };

  const toggleHelp = useCallback(() => {
    setState(s => {
      if (!s.showHelp) {
        trackEvent('help_open');
      }
      return { ...s, showHelp: !s.showHelp };
    });
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+/ or F1 for help
      if ((e.ctrlKey && e.key === '/') || e.key === 'F1') {
        e.preventDefault();
        toggleHelp();
      }
      // Ctrl+Z for undo
      if (e.ctrlKey && e.key === 'z' && state.undoStack.length > 0) {
        e.preventDefault();
        undo();
      }
      // Escape to close help
      if (e.key === 'Escape' && state.showHelp) {
        toggleHelp();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state.showHelp, state.undoStack.length, toggleHelp]);

  const contextValue: AppContextType = {
    state,
    login,
    logout,
    setMode,
    setTargetTenant,
    completePhase,
    goToPhase,
    addUndo,
    undo,
    dismissUndo,
    toggleHelp,
  };

  const onboardingDone = isOnboardingComplete(state.completedPhases);
  const inOnboarding = ONBOARDING_GATE_ENABLED ? !onboardingDone : state.mode === 'onboarding';
  const onboardingResume = resumePath(state.completedPhases);

  return (
    <AppContext.Provider value={contextValue}>
      <ThemeProvider>
      <BrowserRouter basename="/configurator">
        <PageViewTracker />
        <a href="#main-content" className="skip-link">Skip to main content</a>
        <Routes>
          <Route path="/account" element={<AccountPage />} />
          <Route path="/members" element={state.isAuthenticated ? <MembersPage /> : <Navigate to="/login" />} />
          <Route path="/workspace-settings" element={state.isAuthenticated ? <WorkspacePage /> : <Navigate to="/login" />} />
          <Route path="/login" element={<LoginPage />} />
          {/* Self-serve onboarding (CCRS#1999). Public: the whole point is that
              nobody has an account yet, so it sits outside the auth gate. */}
          <Route path="/signup" element={<SignupPage />} />

          {/* Onboarding. With the gate on, an account stays here until every
              step is done; with it off, the mode switch decides as before. */}
          <Route path="/" element={
            state.isAuthenticated
              ? inOnboarding ? <MastersCapabilityProvider><OnboardingLayout /></MastersCapabilityProvider> : <Navigate to="/manage" />
              : <RootLanding />
          }>
            <Route index element={<Navigate to={onboardingResume} replace />} />
            <Route path="onboarding/branding" element={<BrandingStep />} />
            <Route path="onboarding/geography" element={<GeographyStep />} />
            <Route path="onboarding/departments" element={<DepartmentsStep />} />
            <Route path="onboarding/employees" element={<EmployeesStep />} />
            <Route path="onboarding/complaints" element={<ComplaintsStep />} />
            <Route path="onboarding/*" element={<Navigate to={onboardingResume} replace />} />
            {/* The old numbered phases, for bookmarks and the pages that still link to them */}
            <Route path="phase/:number" element={<LegacyPhaseRedirect />} />
            <Route path="complete" element={<Navigate to="/onboarding/complaints" replace />} />
          </Route>

          {/* Management Mode Routes — react-admin powered */}
          <Route path="/manage/*" element={
            state.isAuthenticated && !inOnboarding
              ? <ManagementAdmin />
              : state.isAuthenticated ? <Navigate to={onboardingResume} /> : <Navigate to="/login" />
          } />
        </Routes>

        {/* Global modals and toasts */}
        {state.showHelp && <HelpModal onClose={toggleHelp} />}
        <Toaster />
      </BrowserRouter>
      </ThemeProvider>
    </AppContext.Provider>
  );
}

/** /phase/N, the old numbered route, to the step that replaced it. */
function LegacyPhaseRedirect() {
  const { number } = useParams();
  const step = ONBOARDING_STEPS.find((candidate) => String(candidate.number) === number) ?? ONBOARDING_STEPS[0];
  return <Navigate to={step.path} replace />;
}

export default App;
