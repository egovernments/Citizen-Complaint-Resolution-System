/**
 * Theme presets for the DIGIT Configurator UI.
 *
 * Themes are CSS variable presets applied at runtime on <html>.
 * The app uses Tailwind + CSS variables (NOT MUI), so swapping
 * these variables is all that's needed to change the visual theme.
 *
 * Values are HSL strings without "hsl()" wrapper, e.g. "24 91% 42%".
 */

export interface ThemePreset {
  name: string;
  label: string;
  /** Primary color in hex for preview swatches */
  primaryHex: string;
  dark: boolean;
  variables: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

const digitOrange: ThemePreset = {
  name: 'digit-orange',
  label: 'DIGIT Orange',
  primaryHex: '#C84C0E',
  dark: false,
  variables: {
    '--background': '0 0% 93%',
    '--foreground': '0 8% 4%',
    '--card': '0 0% 100%',
    '--card-foreground': '0 8% 4%',
    '--popover': '0 0% 100%',
    '--popover-foreground': '0 8% 4%',
    '--primary': '24 91% 42%',
    '--primary-foreground': '0 0% 100%',
    '--secondary': '204 38% 22%',
    '--secondary-foreground': '0 0% 100%',
    '--muted': '0 0% 96%',
    '--muted-foreground': '200 9% 34%',
    '--accent': '24 91% 96%',
    '--accent-foreground': '24 91% 42%',
    '--destructive': '7 77% 47%',
    '--destructive-foreground': '0 0% 100%',
    '--border': '30 3% 83%',
    '--input': '200 9% 34%',
    '--ring': '24 91% 42%',
    '--radius': '0.25rem',
    '--chart-1': '204 80% 43%',
    '--chart-2': '45 93% 58%',
    '--chart-3': '280 60% 52%',
    '--chart-4': '28 85% 56%',
    '--chart-5': '187 85% 53%',
  },
};

const materialIndigo: ThemePreset = {
  name: 'material-indigo',
  label: 'Material Indigo',
  primaryHex: '#3F51B5',
  dark: false,
  variables: {
    '--background': '220 14% 94%',
    '--foreground': '220 13% 10%',
    '--card': '0 0% 100%',
    '--card-foreground': '220 13% 10%',
    '--popover': '0 0% 100%',
    '--popover-foreground': '220 13% 10%',
    '--primary': '231 48% 48%',
    '--primary-foreground': '0 0% 100%',
    '--secondary': '231 44% 94%',
    '--secondary-foreground': '231 48% 30%',
    '--muted': '220 14% 96%',
    '--muted-foreground': '220 9% 46%',
    '--accent': '231 48% 94%',
    '--accent-foreground': '231 48% 48%',
    '--destructive': '4 90% 58%',
    '--destructive-foreground': '0 0% 100%',
    '--border': '220 13% 85%',
    '--input': '220 9% 46%',
    '--ring': '231 48% 48%',
    '--radius': '0.375rem',
    '--chart-1': '231 48% 48%',
    '--chart-2': '291 47% 51%',
    '--chart-3': '174 100% 29%',
    '--chart-4': '36 100% 50%',
    '--chart-5': '4 90% 58%',
  },
};

const materialTeal: ThemePreset = {
  name: 'material-teal',
  label: 'Material Teal',
  primaryHex: '#009688',
  dark: false,
  variables: {
    '--background': '174 14% 93%',
    '--foreground': '174 13% 8%',
    '--card': '0 0% 100%',
    '--card-foreground': '174 13% 8%',
    '--popover': '0 0% 100%',
    '--popover-foreground': '174 13% 8%',
    '--primary': '174 100% 29%',
    '--primary-foreground': '0 0% 100%',
    '--secondary': '174 40% 93%',
    '--secondary-foreground': '174 100% 20%',
    '--muted': '174 14% 96%',
    '--muted-foreground': '174 9% 42%',
    '--accent': '174 60% 93%',
    '--accent-foreground': '174 100% 29%',
    '--destructive': '4 90% 58%',
    '--destructive-foreground': '0 0% 100%',
    '--border': '174 10% 84%',
    '--input': '174 9% 42%',
    '--ring': '174 100% 29%',
    '--radius': '0.375rem',
    '--chart-1': '174 100% 29%',
    '--chart-2': '36 100% 50%',
    '--chart-3': '231 48% 48%',
    '--chart-4': '291 47% 51%',
    '--chart-5': '4 90% 58%',
  },
};

const materialBlue: ThemePreset = {
  name: 'material-blue',
  label: 'Material Blue',
  primaryHex: '#2196F3',
  dark: false,
  variables: {
    '--background': '207 14% 93%',
    '--foreground': '207 13% 8%',
    '--card': '0 0% 100%',
    '--card-foreground': '207 13% 8%',
    '--popover': '0 0% 100%',
    '--popover-foreground': '207 13% 8%',
    '--primary': '207 90% 54%',
    '--primary-foreground': '0 0% 100%',
    '--secondary': '207 44% 93%',
    '--secondary-foreground': '207 90% 30%',
    '--muted': '207 14% 96%',
    '--muted-foreground': '207 9% 42%',
    '--accent': '207 80% 94%',
    '--accent-foreground': '207 90% 54%',
    '--destructive': '4 90% 58%',
    '--destructive-foreground': '0 0% 100%',
    '--border': '207 10% 84%',
    '--input': '207 9% 42%',
    '--ring': '207 90% 54%',
    '--radius': '0.375rem',
    '--chart-1': '207 90% 54%',
    '--chart-2': '174 100% 29%',
    '--chart-3': '36 100% 50%',
    '--chart-4': '291 47% 51%',
    '--chart-5': '4 90% 58%',
  },
};

const digitDark: ThemePreset = {
  name: 'digit-dark',
  label: 'DIGIT Dark',
  primaryHex: '#E8854A',
  dark: true,
  variables: {
    '--background': '0 0% 7%',
    '--foreground': '0 0% 93%',
    '--card': '0 0% 10%',
    '--card-foreground': '0 0% 93%',
    '--popover': '0 0% 10%',
    '--popover-foreground': '0 0% 93%',
    '--primary': '24 78% 60%',
    '--primary-foreground': '0 0% 5%',
    '--secondary': '204 30% 18%',
    '--secondary-foreground': '0 0% 93%',
    '--muted': '0 0% 14%',
    '--muted-foreground': '0 0% 60%',
    '--accent': '24 40% 16%',
    '--accent-foreground': '24 78% 60%',
    '--destructive': '7 77% 55%',
    '--destructive-foreground': '0 0% 100%',
    '--border': '0 0% 18%',
    '--input': '0 0% 18%',
    '--ring': '24 78% 60%',
    '--radius': '0.25rem',
    '--chart-1': '204 80% 55%',
    '--chart-2': '45 93% 58%',
    '--chart-3': '280 60% 60%',
    '--chart-4': '28 85% 60%',
    '--chart-5': '187 85% 55%',
  },
};

/**
 * The onboarding palette, taken from Bomet's own live theme rather than the
 * reference build.
 *
 * Read off `bometfeedbackhub.digit.org` after its `common-masters.ThemeConfig`
 * had applied, which matters: sampled before that, the page still shows the
 * DIGIT orange defaults, and those are not what any Bomet user sees.
 *
 *   --color-primary-2   #2563EB   the blue
 *   --color-secondary   #0B1F3A   the navy chrome and the panel scrim
 *   --color-text-*      #1D2433 / #4B5563 / #6B7280
 *   --color-border      #E5E7EB
 *
 * The reference build is close but not the same (#2D4FC4 and #0C184A), and
 * matching it would put onboarding a shade away from the product a tenant
 * enters straight afterwards. Matching Bomet keeps the two continuous.
 */
const cmsBlue: ThemePreset = {
  name: 'cms-blue',
  label: 'CMS Blue',
  primaryHex: '#2563EB',
  dark: false,
  variables: {
    '--background': '220 33% 98%',
    '--foreground': '221 28% 16%',
    '--card': '0 0% 100%',
    '--card-foreground': '221 28% 16%',
    '--popover': '0 0% 100%',
    '--popover-foreground': '221 28% 16%',
    '--primary': '221 83% 53%',
    '--primary-foreground': '0 0% 100%',
    // The navy the left panel is built on, and the scrim over the photograph.
    '--secondary': '214 68% 14%',
    '--secondary-foreground': '0 0% 100%',
    '--muted': '220 20% 96%',
    '--muted-foreground': '220 9% 46%',
    '--accent': '220 88% 97%',
    '--accent-foreground': '221 83% 53%',
    '--destructive': '7 77% 47%',
    '--destructive-foreground': '0 0% 100%',
    '--border': '220 13% 91%',
    '--input': '220 13% 91%',
    '--ring': '221 83% 53%',
    // 8px, from the reference. The DIGIT presets use 0.25rem, so this is a
    // deliberate difference rather than a stray value.
    '--radius': '0.5rem',
    '--chart-1': '221 83% 53%',
    '--chart-2': '45 93% 58%',
    '--chart-3': '280 60% 52%',
    '--chart-4': '28 85% 56%',
    '--chart-5': '187 85% 53%',
  },
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const THEMES: ThemePreset[] = [
  cmsBlue,
  digitOrange,
  materialIndigo,
  materialTeal,
  materialBlue,
  digitDark,
];

const THEME_MAP = new Map(THEMES.map((t) => [t.name, t]));

const STORAGE_KEY = 'digit-theme';

export function getStoredTheme(): string {
  return localStorage.getItem(STORAGE_KEY) || 'digit-orange';
}

/**
 * A preset's variables, for a surface that wants to scope a palette to its own
 * subtree rather than to the document.
 *
 * Scoping beats setting them on `documentElement` from a child, because
 * ThemeProvider sits above and its effect runs after any child's — so a child
 * that paints the root gets quietly overwritten on mount. Custom properties
 * cascade, so the nearest ancestor wins and there is nothing to restore.
 */
export function themeVariables(name: string): Record<string, string> {
  return { ...(THEME_MAP.get(name)?.variables ?? {}) };
}

/**
 * Paint a theme without remembering it.
 *
 * Split out from `applyTheme` for surfaces that set their own look for as long
 * as they are mounted and hand it back afterwards — the signup flow does this,
 * and persisting there would leave the admin console wearing the onboarding
 * palette for every later visit.
 */
export function applyThemeVariables(name: string): boolean {
  const preset = THEME_MAP.get(name);
  if (!preset) return false;

  const root = document.documentElement;
  for (const [prop, value] of Object.entries(preset.variables)) {
    root.style.setProperty(prop, value);
  }
  if (preset.dark) {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
  return true;
}

export function applyTheme(name: string): void {
  if (!applyThemeVariables(name)) return;
  localStorage.setItem(STORAGE_KEY, name);
}
