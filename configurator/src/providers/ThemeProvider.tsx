import { createContext, useContext, useState, useLayoutEffect, type ReactNode } from 'react';
import { applyTheme, applyThemeVariables, getStoredTheme, THEMES } from '@/themes';

interface ThemeContextValue {
  theme: string;
  setTheme: (name: string) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState(() => getStoredTheme());

  // Before the first paint, so a saved preset never flashes the CSS default.
  // Paint only: saving here would record the default as if it were a pick.
  useLayoutEffect(() => {
    applyThemeVariables(theme);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setTheme = (name: string) => {
    if (THEMES.some((t) => t.name === name)) {
      applyTheme(name);
      setThemeState(name);
    }
  };

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
