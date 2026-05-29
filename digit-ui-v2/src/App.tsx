/**
 * Citizen UI entry — forked from digit-configurator, stripped to:
 *   /login            CitizenLoginPage      mobile + OTP (fixed 123456)
 *   /dashboard        CitizenDashboardPage  one external dashboard link
 *
 * basename=/citizen — served from /var/www/citizen on naipepea.
 *
 * Auth state is the slimmest viable shape — anything richer (preferences,
 * complaint drafts, profile fields) can extend the AppState type in place.
 */
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useState, createContext, useContext, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CoreAdminContext } from 'ra-core';
import CitizenLoginPage from './pages/CitizenLoginPage';
import CitizenKcCallback from './pages/CitizenKcCallback';
import CitizenDashboardPage from './pages/CitizenDashboardPage';
import CitizenComplaintsListPage from './pages/CitizenComplaintsListPage';
import CitizenComplaintShowPage from './pages/CitizenComplaintShowPage';
import CitizenComplaintCreatePage from './pages/CitizenComplaintCreatePage';
import CitizenProfilePage from './pages/CitizenProfilePage';
import CitizenDashboardV2Page from './pages/CitizenDashboardV2Page';
import CitizenLayout from './components/layout/CitizenLayout';
import { ThemeProvider } from './providers/ThemeProvider';
import { citizenDataProvider, citizenAuthProvider } from './providers/citizenBridge';
// Toaster removed — citizen UI v1 surfaces errors via inline Alert components.
import { apiClient, getApiBaseUrl } from './api';
import { identifyUser, clearUser, trackEvent } from './lib/telemetry';
import './App.css';

// One QueryClient for the whole app — the PGR dashboard uses useQuery to
// fetch /pgr-services/v2/dashboard with a 60s stale window. Carried over
// from the configurator's CoreAdminContext default.
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 60_000 } },
});

const AUTH_STORAGE_KEY = 'crs-citizen-auth';

interface CitizenUser {
  name: string;
  mobile: string;
  uuid?: string;
  type: 'CITIZEN';
}

interface AppState {
  isAuthenticated: boolean;
  user: CitizenUser | null;
  /** State tenant the citizen is registered under (`ke` on naipepea). */
  tenant: string;
}

interface AppContextType {
  state: AppState;
  login: (user: CitizenUser, tenant: string) => void;
  logout: () => void;
}

const AppContext = createContext<AppContextType | null>(null);

export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
};

/** Restore session from localStorage. Returns null if nothing valid found. */
function restoreSession(): { user: CitizenUser; tenant: string } | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { authToken?: string; user?: CitizenUser; tenant?: string };
    if (!parsed.authToken || !parsed.user || !parsed.tenant) return null;
    // Re-hydrate apiClient so the citizen's token survives HMR / refresh.
    apiClient.setEnvironment(getApiBaseUrl());
    apiClient.setAuth(parsed.authToken, {
      id: 0,
      uuid: parsed.user.uuid ?? '',
      userName: parsed.user.mobile,
      name: parsed.user.name,
      mobileNumber: parsed.user.mobile,
      type: 'CITIZEN',
      roles: [{ code: 'CITIZEN', name: 'Citizen', tenantId: parsed.tenant }],
      tenantId: parsed.tenant,
    });
    apiClient.setTenantId(parsed.tenant);
    return { user: parsed.user, tenant: parsed.tenant };
  } catch {
    return null;
  }
}

function App() {
  const [state, setState] = useState<AppState>(() => {
    const restored = restoreSession();
    if (restored) {
      return { isAuthenticated: true, ...restored };
    }
    return { isAuthenticated: false, user: null, tenant: 'ke' };
  });

  // Re-identify telemetry on session restore.
  useEffect(() => {
    if (state.isAuthenticated && state.user) {
      identifyUser({
        id: state.user.uuid ?? state.user.mobile,
        name: state.user.name,
        tenant: state.tenant,
        roles: ['CITIZEN'],
      });
      trackEvent('session_restored', { tenant: state.tenant });
    }
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist on auth change.
  useEffect(() => {
    if (state.isAuthenticated && state.user) {
      localStorage.setItem(
        AUTH_STORAGE_KEY,
        JSON.stringify({
          user: state.user,
          tenant: state.tenant,
          authToken: apiClient.getAuth().token,
        }),
      );
    }
  }, [state.isAuthenticated, state.user, state.tenant]);

  const login = (user: CitizenUser, tenant: string) => {
    setState({ isAuthenticated: true, user, tenant });
    identifyUser({ id: user.uuid ?? user.mobile, name: user.name, tenant, roles: ['CITIZEN'] });
    trackEvent('login', { tenant });
  };

  const logout = () => {
    trackEvent('logout');
    clearUser();
    localStorage.removeItem(AUTH_STORAGE_KEY);
    apiClient.logout();
    setState({ isAuthenticated: false, user: null, tenant: state.tenant });
  };

  return (
    <AppContext.Provider value={{ state, login, logout }}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter basename="/citizen">
          {/*
           * CoreAdminContext goes INSIDE BrowserRouter — ra-core v5's
           * <CoreAdminContext> ships its own Router for the
           * <CoreAdminUI>/<Resource> case, but mounting it inside an
           * existing Router prevents the duplicate. Our app doesn't use
           * <CoreAdminUI>; we drive routes ourselves and only need the
           * dataProvider/authProvider context for ListBase/ShowBase/useCreate.
           */}
          <CoreAdminContext
            dataProvider={citizenDataProvider}
            authProvider={citizenAuthProvider}
            queryClient={queryClient}
          >
            <ThemeProvider>
              <Routes>
                <Route path="/login" element={<CitizenLoginPage />} />
                {/* KC callback is intentionally unguarded — the user is
                   mid-auth at this point and not yet logged in. */}
                <Route path="/auth/callback" element={<CitizenKcCallback />} />
                <Route
                  path="/"
                  element={state.isAuthenticated ? <CitizenLayout /> : <Navigate to="/login" replace />}
                >
                  <Route index element={<Navigate to="/dashboard" replace />} />
                  <Route path="dashboard" element={<CitizenDashboardPage />} />
                  <Route path="complaints" element={<CitizenComplaintsListPage />} />
                  <Route path="complaints/create" element={<CitizenComplaintCreatePage />} />
                  <Route path="complaints/:id/show" element={<CitizenComplaintShowPage />} />
                  <Route path="profile" element={<CitizenProfilePage />} />
                  <Route path="dashboard-v2" element={<CitizenDashboardV2Page />} />
                </Route>
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </ThemeProvider>
          </CoreAdminContext>
        </BrowserRouter>
      </QueryClientProvider>
    </AppContext.Provider>
  );
}

export default App;
