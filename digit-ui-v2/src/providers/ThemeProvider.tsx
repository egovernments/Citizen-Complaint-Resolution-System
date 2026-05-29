import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { applyTheme, getStoredTheme, THEMES } from '@/themes';

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

  // Apply on mount
  useEffect(() => {
    applyTheme(theme);
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
