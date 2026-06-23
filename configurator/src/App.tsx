import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useState, createContext, useContext, useEffect, useCallback } from 'react';
import Layout from './components/layout/Layout';
import LoginPage from './pages/LoginPage';
import Phase1Page from './pages/Phase1Page';
import Phase2Page from './pages/Phase2Page';
import Phase3Page from './pages/Phase3Page';
import Phase4Page from './pages/Phase4Page';
import CommunicationsPage from './pages/CommunicationsPage';
import CompletePage from './pages/CompletePage';
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
  AdvancedPage,
} from '@/resources';
import PgrDashboard from './pages/PgrDashboard';
import { getGenericMdmsResources, getDataProvider, getAuthProvider, configureDigitClient, digitClient, resetProviders, i18nProvider } from '@/providers/bridge';
import { ThemeProvider } from '@/providers/ThemeProvider';
import HelpModal from './components/ui/HelpModal';
// UndoToast removed — see CCRS#417. The previous Undo button only popped
// the local UI stack; egov-mdms-service exposes no `_delete`/`_disable`
// endpoint, so there is no real way to roll back a created tenant +
// branding + localization rows from this UI today. The button promised
// rollback it couldn't deliver, so we hide it until the backend grows
// proper compensators (or until product defines a different semantic for
// "Undo" — e.g. soft-deactivate via `_update isActive=false` for schemas
// without unique-key collisions).
// import UndoToast from './components/ui/UndoToast';
import { Toaster } from './components/ui/toaster';
import { apiClient, getApiBaseUrl } from './api';
import { identifyUser, clearUser, trackEvent } from './lib/telemetry';
import PageViewTracker from './components/PageViewTracker';
import './App.css';

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
  logout: () => void;
  setMode: (mode: AppMode) => void;
  /** Point subsequent onboarding writes/reads at a child tenant. Called by
   *  Phase 1 after `tenant.tenants` create succeeds. */
  setTargetTenant: (code: string) => void;
  completePhase: (phase: number) => void;
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
  const { state } = useApp();
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
        <Resource name="tenants" list={TenantList} show={TenantShow} edit={TenantEdit} />
        <Resource name="departments" list={DepartmentList} show={DepartmentShow} edit={DepartmentEdit} create={DepartmentCreate} />
        <Resource name="designations" list={DesignationList} show={DesignationShow} edit={DesignationEdit} create={DesignationCreate} />
        <Resource name="complaint-types" list={ComplaintTypeList} show={ComplaintTypeShow} edit={ComplaintTypeEdit} create={ComplaintTypeCreate} />
        <Resource name="employees" list={EmployeeList} show={EmployeeShow} edit={EmployeeEdit} create={EmployeeCreate} />
        <Resource name="complaints" list={ComplaintList} show={ComplaintShow} edit={ComplaintEdit} create={ComplaintCreate} />
        <Resource name="boundaries" list={BoundaryList} show={BoundaryShow} edit={BoundaryEdit} create={BoundaryCreate} />
        <Resource name="localization" list={LocalizationList} show={LocalizationShow} edit={LocalizationEdit} create={LocalizationCreate} />
        <Resource name="users" list={UserList} show={UserShow} edit={UserEdit} create={UserCreate} />

        {/* Read-only entities with List/Show */}
        <Resource name="access-roles" list={AccessRoleList} show={AccessRoleShow} />
        <Resource name="access-actions" list={AccessActionList} show={AccessActionShow} />
        <Resource name="role-actions" list={RoleActionList} show={RoleActionShow} />
        <Resource name="workflow-business-services" list={WorkflowServiceList} show={WorkflowServiceShow} />
        <Resource name="workflow-processes" list={WorkflowProcessList} show={WorkflowProcessShow} />
        <Resource name="mdms-schemas" list={MdmsSchemaList} show={MdmsSchemaShow} />
        <Resource name="boundary-hierarchies" list={BoundaryHierarchyList} show={BoundaryHierarchyShow} create={BoundaryHierarchyCreate} />

        {/* Generic MDMS with Show/Edit/Create (exclude resources with dedicated UI above) */}
        {Object.keys(getGenericMdmsResources()).filter((name) => name !== 'role-actions').map((name) => (
          <Resource key={name} name={name} list={MdmsResourcePage} show={MdmsResourceShow} edit={MdmsResourceEdit} create={MdmsResourceCreate} />
        ))}

        {/* Custom routes */}
        <CustomRoutes>
          <Route path="/advanced" element={<AdvancedPage />} />
          <Route path="/pgr-dashboard" element={<PgrDashboard />} />
          <Route path="/employees/bulk" element={<EmployeeBulkImport />} />
          <Route path="/departments/bulk" element={<DepartmentBulkImport />} />
          <Route path="/designations/bulk" element={<DesignationBulkImport />} />
          <Route path="/localization/bulk" element={<LocalizationBulkImport />} />
        </CustomRoutes>
      </CoreAdminUI>
    </CoreAdminContext>
  );
}

// Storage key for persisting auth state
const AUTH_STORAGE_KEY = 'crs-auth-state';

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
    return {
      isAuthenticated: false,
      user: null,
      environment: getApiBaseUrl(),
      tenant: 'ke',
      targetTenant: 'ke',
      mode: 'onboarding',
      currentPhase: 1,
      completedPhases: [],
      undoStack: [],
      showHelp: false,
    };
  });

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
            const authData = {
        isAuthenticated: state.isAuthenticated,
        user: state.user,
        environment: state.environment,
        tenant: state.tenant,
        targetTenant: state.targetTenant,
        mode: state.mode,
        currentPhase: state.currentPhase,
        completedPhases: state.completedPhases,
        authToken: apiClient.getAuth().token,
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

  const logout = () => {
    trackEvent('logout', { tenant: state.tenant });
    clearUser();

    // Clear localStorage
    localStorage.removeItem(AUTH_STORAGE_KEY);
    // Clear apiClient and digitClient
    apiClient.logout();
    digitClient.clearAuth();
    resetProviders();
    setState(s => ({ ...s, isAuthenticated: false, user: null, mode: 'onboarding', currentPhase: 1, completedPhases: [], targetTenant: s.tenant }));
  };

  const completePhase = (phase: number) => {
    setState(s => ({
      ...s,
      completedPhases: [...new Set([...s.completedPhases, phase])],
      currentPhase: Math.min(phase + 1, 6),
    }));
    trackEvent('phase_complete', { phase, tenant: state.tenant });

    // Track onboarding completion
    if (phase === 4) {
      trackEvent('onboarding_complete', { tenant: state.tenant });
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

  return (
    <AppContext.Provider value={contextValue}>
      <ThemeProvider>
      <BrowserRouter basename="/configurator">
        <PageViewTracker />
        <a href="#main-content" className="skip-link">Skip to main content</a>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          {/* Onboarding Mode Routes */}
          <Route path="/" element={
            state.isAuthenticated
              ? state.mode === 'onboarding' ? <Layout /> : <Navigate to="/manage" />
              : <Navigate to="/login" />
          }>
            <Route index element={<Navigate to="/phase/1" />} />
            <Route path="phase/1" element={<Phase1Page />} />
            <Route path="phase/2" element={<Phase2Page />} />
            <Route path="phase/3" element={<Phase3Page />} />
            <Route path="phase/4" element={<Phase4Page />} />
            <Route path="phase/5" element={<CommunicationsPage />} />
            <Route path="complete" element={<CompletePage />} />
          </Route>

          {/* Management Mode Routes — react-admin powered */}
          <Route path="/manage/*" element={
            state.isAuthenticated && state.mode === 'management'
              ? <ManagementAdmin />
              : state.isAuthenticated ? <Navigate to="/phase/1" /> : <Navigate to="/login" />
          } />
        </Routes>

        {/* Global modals and toasts */}
        {state.showHelp && <HelpModal onClose={toggleHelp} />}
        {/* <UndoToast items={state.undoStack} onUndo={undo} onDismiss={dismissUndo} /> */}
        <Toaster />
      </BrowserRouter>
      </ThemeProvider>
    </AppContext.Provider>
  );
}

export default App;
