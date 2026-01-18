import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useState, createContext, useContext, useEffect, useCallback } from 'react';
import Layout from './components/layout/Layout';
import LoginPage from './pages/LoginPage';
import Phase1Page from './pages/Phase1Page';
import Phase2Page from './pages/Phase2Page';
import Phase3Page from './pages/Phase3Page';
import Phase4Page from './pages/Phase4Page';
import CompletePage from './pages/CompletePage';
import HelpModal from './components/ui/HelpModal';
import UndoToast from './components/ui/UndoToast';
import './App.css';

// App context for global state
interface AppState {
  isAuthenticated: boolean;
  user: { name: string; email: string; roles: string[] } | null;
  environment: string;
  tenant: string;
  currentPhase: number;
  completedPhases: number[];
  undoStack: { id: string; action: string; description: string; timestamp: Date }[];
  showHelp: boolean;
}

interface AppContextType {
  state: AppState;
  login: (user: AppState['user'], env: string, tenant: string) => void;
  logout: () => void;
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

function App() {
  const [state, setState] = useState<AppState>({
    isAuthenticated: false,
    user: null,
    environment: 'https://unified-dev.digit.org',
    tenant: 'pg',
    currentPhase: 1,
    completedPhases: [],
    undoStack: [],
    showHelp: false,
  });

  const login = (user: AppState['user'], env: string, tenant: string) => {
    setState(s => ({ ...s, isAuthenticated: true, user, environment: env, tenant }));
  };

  const logout = () => {
    setState(s => ({ ...s, isAuthenticated: false, user: null, currentPhase: 1, completedPhases: [] }));
  };

  const completePhase = (phase: number) => {
    setState(s => ({
      ...s,
      completedPhases: [...new Set([...s.completedPhases, phase])],
      currentPhase: Math.min(phase + 1, 5),
    }));
  };

  const goToPhase = (phase: number) => {
    setState(s => ({ ...s, currentPhase: phase }));
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
    setState(s => ({ ...s, showHelp: !s.showHelp }));
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
        <a href="#main-content" className="skip-link">Skip to main content</a>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={state.isAuthenticated ? <Layout /> : <Navigate to="/login" />}>
            <Route index element={<Navigate to="/phase/1" />} />
            <Route path="phase/1" element={<Phase1Page />} />
            <Route path="phase/2" element={<Phase2Page />} />
            <Route path="phase/3" element={<Phase3Page />} />
            <Route path="phase/4" element={<Phase4Page />} />
            <Route path="complete" element={<CompletePage />} />
          </Route>
        </Routes>

        {/* Global modals and toasts */}
        {state.showHelp && <HelpModal onClose={toggleHelp} />}
        <UndoToast items={state.undoStack} onUndo={undo} onDismiss={dismissUndo} />
      </BrowserRouter>
    </AppContext.Provider>
  );
}

export default App;
