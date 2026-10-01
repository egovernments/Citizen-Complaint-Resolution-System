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

/**
 * DIGIT Orange, the eGov design system as the DIGIT admin console ships it:
 * every value here is that console's own token, so the Configurator reads the
 * same as the other eGov products.
 *
 *   primary     #C84C0E   the DIGIT orange
 *   secondary   #0B4B66   the DIGIT teal
 *   text        #363636, muted #787878; lines #D6D5D4, input strokes #505A5F
 *   surfaces    white page, #FAFAFA sidebar, #EEEEEE muted
 *   status      error #B91900, success #00703C, warning #9E5F00, info #0057BD
 */
const digitOrange: ThemePreset = {
  name: 'digit-orange',
  label: 'DIGIT Orange',
  primaryHex: '#C84C0E',
  dark: false,
  variables: {
    '--background': '0 0% 100%',
    '--foreground': '0 0% 21.2%',
    '--card': '0 0% 100%',
    '--card-foreground': '0 0% 21.2%',
    '--sidebar': '0 0% 98%',
    '--popover': '0 0% 100%',
    '--popover-foreground': '0 0% 21.2%',
    '--primary': '20 86.9% 42%',
    '--primary-foreground': '0 0% 100%',
    '--secondary': '197.8 80.5% 22.2%',
    '--secondary-foreground': '0 0% 100%',
    '--muted': '0 0% 93.3%',
    '--muted-foreground': '0 0% 47.1%',
    '--accent': '7 100% 98%',
    '--accent-foreground': '20 86.9% 42%',
    '--destructive': '8.1 100% 36.3%',
    '--destructive-foreground': '0 0% 100%',
    '--border': '30 2.4% 83.5%',
    '--input': '200 8.6% 34.3%',
    '--ring': '20 86.9% 42%',
    '--radius': '0.25rem',
    '--chart-1': '20 86.9% 42%',
    '--chart-2': '197.8 80.5% 22.2%',
    '--chart-3': '212.4 100% 37.1%',
    '--chart-4': '152.1 100% 22%',
    '--chart-5': '36.1 100% 31%',
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
    '--sidebar': '0 0% 100%',
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
    '--sidebar': '0 0% 100%',
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
    '--sidebar': '0 0% 100%',
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
    '--sidebar': '0 0% 10%',
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
    '--sidebar': '0 0% 100%',
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

/**
 * Where a preset picked from the top bar is kept. Only a pick is saved; the
 * default never is. The old key, `digit-theme`, was written on every load
 * whatever was showing, so for anyone who visited while DIGIT Orange was the
 * default it holds that default as if it were a choice. It is no longer read.
 *
 * Exported for the Keycloak login theme: it is served from the same origin and
 * follows the same choice, so the sign-in screens don't change colour midway.
 */
export const THEME_STORAGE_KEY = 'digit-theme-choice';

export function getStoredTheme(): string {
  // CMS Blue until someone picks another preset from the top bar.
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    return saved && THEME_MAP.has(saved) ? saved : 'cms-blue';
  } catch {
    // Storage blocked (private windows, site data off): the default it is.
    return 'cms-blue';
  }
}

/** Paint a theme on the document without remembering it; `applyTheme` also saves it. */
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

/** Paint a theme and remember it: for an explicit pick, never for a default. */
export function applyTheme(name: string): void {
  if (!applyThemeVariables(name)) return;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, name);
  } catch {
    // Storage blocked: the pick holds for this page only.
  }
}
