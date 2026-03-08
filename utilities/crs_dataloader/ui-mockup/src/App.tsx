import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useState, createContext, useContext, useEffect, useCallback } from 'react';
import Layout from './components/layout/Layout';
import LoginPage from './pages/LoginPage';
import Phase1Page from './pages/Phase1Page';
import Phase2Page from './pages/Phase2Page';
import Phase3Page from './pages/Phase3Page';
import Phase4Page from './pages/Phase4Page';
import CompletePage from './pages/CompletePage';
import { CoreAdminContext, CoreAdminUI, Resource, CustomRoutes } from 'ra-core';
import { QueryClient } from '@tanstack/react-query';
import { DigitLayout, DigitDashboard, MdmsResourcePage, MdmsResourceShow, MdmsResourceEdit } from '@/admin';
import {
  DepartmentList, DepartmentShow, DepartmentEdit,
  DesignationList, DesignationShow, DesignationEdit,
  ComplaintTypeList, ComplaintTypeShow, ComplaintTypeEdit,
  TenantList, TenantShow,
  EmployeeList, EmployeeShow, EmployeeEdit,
  ComplaintList, ComplaintShow, ComplaintEdit,
  BoundaryList, BoundaryShow, BoundaryEdit,
  LocalizationList, LocalizationShow, LocalizationEdit,
  UserList, UserShow, UserEdit,
  AccessRoleList, AccessRoleShow,
  WorkflowServiceList, WorkflowServiceShow,
  WorkflowProcessList, WorkflowProcessShow,
  MdmsSchemaList, MdmsSchemaShow,
  BoundaryHierarchyList, BoundaryHierarchyShow,
  AdvancedPage,
} from '@/resources';
import { getGenericMdmsResources, getDataProvider, getAuthProvider, configureDigitClient, digitClient, resetProviders } from '@/providers/bridge';
import HelpModal from './components/ui/HelpModal';
import UndoToast from './components/ui/UndoToast';
import { Toaster } from './components/ui/toaster';
import { apiClient } from './api';
import { identifyUser, clearUser, trackEvent } from './lib/telemetry';
import PageViewTracker from './components/PageViewTracker';
import './App.css';

// App context for global state
type AppMode = 'onboarding' | 'management';

interface AppState {
  isAuthenticated: boolean;
  user: { name: string; email: string; roles: string[]; id?: number; uuid?: string; mobileNumber?: string } | null;
  environment: string;
  tenant: string;
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
      queryClient={queryClient}
      basename="/manage"
    >
      <CoreAdminUI layout={DigitLayout} dashboard={DigitDashboard}>
        {/* Core entities with List/Show/Edit */}
        <Resource name="tenants" list={TenantList} show={TenantShow} />
        <Resource name="departments" list={DepartmentList} show={DepartmentShow} edit={DepartmentEdit} />
        <Resource name="designations" list={DesignationList} show={DesignationShow} edit={DesignationEdit} />
        <Resource name="complaint-types" list={ComplaintTypeList} show={ComplaintTypeShow} edit={ComplaintTypeEdit} />
        <Resource name="employees" list={EmployeeList} show={EmployeeShow} edit={EmployeeEdit} />
        <Resource name="complaints" list={ComplaintList} show={ComplaintShow} edit={ComplaintEdit} />
        <Resource name="boundaries" list={BoundaryList} show={BoundaryShow} edit={BoundaryEdit} />
        <Resource name="localization" list={LocalizationList} show={LocalizationShow} edit={LocalizationEdit} />
        <Resource name="users" list={UserList} show={UserShow} edit={UserEdit} />

        {/* Read-only entities with List/Show */}
        <Resource name="access-roles" list={AccessRoleList} show={AccessRoleShow} />
        <Resource name="workflow-business-services" list={WorkflowServiceList} show={WorkflowServiceShow} />
        <Resource name="workflow-processes" list={WorkflowProcessList} show={WorkflowProcessShow} />
        <Resource name="mdms-schemas" list={MdmsSchemaList} show={MdmsSchemaShow} />
        <Resource name="boundary-hierarchies" list={BoundaryHierarchyList} show={BoundaryHierarchyShow} />

        {/* Generic MDMS with Show/Edit */}
        {Object.keys(getGenericMdmsResources()).map((name) => (
          <Resource key={name} name={name} list={MdmsResourcePage} show={MdmsResourceShow} edit={MdmsResourceEdit} />
        ))}

        {/* Custom routes */}
        <CustomRoutes>
          <Route path="/advanced" element={<AdvancedPage />} />
        </CustomRoutes>
      </CoreAdminUI>
    </CoreAdminContext>
  );
}

// Storage key for persisting auth state
const AUTH_STORAGE_KEY = 'crs-auth-state';

// Helper to restore apiClient from localStorage
function restoreApiClientFromStorage(): { isAuthenticated: boolean; user: AppState['user']; environment: string; tenant: string; mode: AppMode; currentPhase: number; completedPhases: number[] } | null {
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

      // Also configure the shared digitClient from the bridge
      const restoredEnv = parsed.environment || 'https://api.egov.theflywheel.in';
      const restoredTenant = parsed.tenant || 'statea';
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
      environment: 'https://api.egov.theflywheel.in',
      tenant: 'statea',
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
        mode: state.mode,
        currentPhase: state.currentPhase,
        completedPhases: state.completedPhases,
        authToken: apiClient.getAuth().token,
      };
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(authData));
    }
  }, [state.isAuthenticated, state.user, state.environment, state.tenant, state.mode, state.currentPhase, state.completedPhases]);

  const login = (user: AppState['user'], env: string, tenant: string, mode: AppMode) => {
    setState(s => ({ ...s, isAuthenticated: true, user, environment: env, tenant, mode }));

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

  const logout = () => {
    trackEvent('logout', { tenant: state.tenant });
    clearUser();

    // Clear localStorage
    localStorage.removeItem(AUTH_STORAGE_KEY);
    // Clear apiClient and digitClient
    apiClient.logout();
    digitClient.clearAuth();
    resetProviders();
    setState(s => ({ ...s, isAuthenticated: false, user: null, mode: 'onboarding', currentPhase: 1, completedPhases: [] }));
  };

  const completePhase = (phase: number) => {
    setState(s => ({
      ...s,
      completedPhases: [...new Set([...s.completedPhases, phase])],
      currentPhase: Math.min(phase + 1, 5),
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
    completePhase,
    goToPhase,
    addUndo,
    undo,
    dismissUndo,
    toggleHelp,
  };

  return (
    <AppContext.Provider value={contextValue}>
      <BrowserRouter>
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
        <UndoToast items={state.undoStack} onUndo={undo} onDismiss={dismissUndo} />
        <Toaster />
      </BrowserRouter>
    </AppContext.Provider>
  );
}

export default App;
