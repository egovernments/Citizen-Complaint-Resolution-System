/**
 * Brand themes an organisation can pick in onboarding. Each is a complete
 * `common-masters.ThemeConfig` colour set, which the citizen and employee apps
 * apply at start-up (digit-ui-esbuild/src/theme/applyTheme.js). They are
 * snapshots of palettes already in use, not new designs:
 *
 *   CMS Blue        Bomet County's live record (bomet-county, v3)
 *   DIGIT Orange    digit-ui's built-in default (src/theme/default.json)
 *   Green and Gold  the ThemeConfig seeded with local-setup (pg)
 */

export interface BrandTheme {
  id: string;
  label: string;
  /** The colour its tile shows. */
  swatch: string;
  version: string;
  colors: Record<string, unknown>;
}

export const DEFAULT_BRAND_THEME_ID = 'cms-blue';

export const BRAND_THEMES: BrandTheme[] = [
  {
    id: 'cms-blue',
    label: 'CMS Blue',
    swatch: '#2563EB',
    version: '3',
    colors: {
      "border": "#D6D5D4",
      "button-primary-bg-default": "#2563EB",
      "button-primary-bg-hover": "#1D4FD8",
      "button-primary-bg-pressed": "#1E40AF",
      "button-primary-border": "#2563EB",
      "button-primary-disabled-bg": "#E5E7EB",
      "button-primary-disabled-text": "#9CA3AF",
      "button-primary-text": "#FFFFFF",
      "button-secondary-bg-default": "#FFFFFF",
      "button-secondary-bg-hover": "#F9FAFB",
      "button-secondary-bg-pressed": "#F3F4F6",
      "button-secondary-border": "#2563EB",
      "button-secondary-text": "#2563EB",
      "button-tertiary-text": "#2563EB",
      "card-border": "#E5E7EB",
      "card-divider": "#E5E7EB",
      "card-error": "#C62828",
      "card-success": "#2E7D32",
      "chart-1": "#2563EB",
      "chart-2": "#E5202A",
      "chart-3": "#128F21",
      "chart-4": "#FEC931",
      "chart-5": "#F58831",
      "digitv2": {
        "alert-error-bg": "#FEF1F2",
        "alert-info": "#1D4ED8",
        "alert-info-bg": "#EFF6FF",
        "alert-success-bg": "#E0F2E1",
        "chart-1": "#2563EB",
        "chart-2": "#E5202A",
        "chart-3": "#128F21",
        "chart-4": "#FEC931",
        "chart-5": "#F58831",
        "header-sidenav": "#0B1F3A",
        "primary-bg": "#EFF6FF",
        "text-color-disabled": "#B1B4B6"
      },
      "error": "#E02D3A",
      "error-dark": "#8B0000",
      "grey": {
        "bg": "#E6E6E6",
        "dark": "#787878",
        "disabled": "#C5C5C5",
        "light": "#FAFAFA",
        "lighter": "#F2F2F2",
        "mid": "#EEEEEE"
      },
      "header-bg": "#0B1F3A",
      "header-icon": "#FFFFFF",
      "header-text": "#FFFFFF",
      "info-dark": "#1D4ED8",
      "input-bg": "#FFFFFF",
      "input-border": "#E1E6EF",
      "input-border-default": "#E1E6EF",
      "input-border-error": "#C62828",
      "input-border-focus": "#2563EB",
      "input-helper": "#6B7280",
      "input-label": "#1D2433",
      "input-placeholder": "#9CA3AF",
      "input-text": "#1D2433",
      "link": {
        "hover": "#1D4FD8",
        "normal": "#2563EB"
      },
      "loader": "#2563EB",
      "page-bg": "#FFFFFF",
      "page-secondary-bg": "#FAFAFA",
      "primary": {
        "accent": "#0B1F3A",
        "dark": "#0B1F3A",
        "light": "#EFF6FF",
        "main": "#2563EB",
        "selected-bg": "#EFF6FF"
      },
      "primary-1": "#0B1F3A",
      "primary-1-bg": "#EFF6FF",
      "primary-2": "#2563EB",
      "primary-2-bg": "#EFF6FF",
      "progress": "#2563EB",
      "secondary": "#0B1F3A",
      "sidebar-bg": "#0B1F3A",
      "sidebar-hover-bg": "#16305A",
      "sidebar-hover-text": "#FFFFFF",
      "sidebar-icon-active": "#FFFFFF",
      "sidebar-selected-bg": "#2563EB",
      "sidebar-selected-text": "#FFFFFF",
      "sidebar-text-active": "#FFFFFF",
      "sidebar-text-default": "#C7D2E3",
      "status-error-bg": "#FEF1F2",
      "status-error-text": "#E02D3A",
      "status-info-bg": "#EFF6FF",
      "status-info-text": "#1D4ED8",
      "status-success-bg": "#E0F2E1",
      "status-success-text": "#128F21",
      "status-warning-text": "#9E5F00",
      "success": "#128F21",
      "table-alt-row": "#FAFAFA",
      "table-border": "#E5E7EB",
      "table-header-bg": "#F3F4F6",
      "table-header-text": "#1D2433",
      "table-hover": "#EFF6FF",
      "table-hover-text": "#1D2433",
      "table-row-bg": "#FFFFFF",
      "table-row-text": "#1D2433",
      "table-selected": "#EFF6FF",
      "table-selected-text": "#1D2433",
      "text": {
        "heading": "#1D2433",
        "muted": "#6B7280",
        "primary": "#1D2433",
        "secondary": "#4B5563"
      },
      "text-disabled": "#C5C5C5",
      "text-heading": "#1D2433",
      "text-muted": "#6B7280",
      "text-primary": "#1D2433",
      "text-secondary": "#4B5563",
      "tooltip-bg": "#0B1F3A",
      "tooltip-text": "#FFFFFF",
      "warning-dark": "#9E5F00"
    },
  },
  {
    id: 'digit-orange',
    label: 'DIGIT Orange',
    swatch: '#C84C0E',
    version: '1',
    colors: {
      "border": "#D6D5D4",
      "digitv2": {
        "alert-error-bg": "#EFC7C1",
        "alert-info": "#3498DB",
        "alert-info-bg": "#C7E0F1",
        "alert-success-bg": "#BAD6C9",
        "chart-1": "#048BD0",
        "chart-2": "#FBC02D",
        "chart-3": "#8E29BF",
        "chart-4": "#EA8A3B",
        "chart-5": "#0BABDE",
        "header-sidenav": "#0B4B66",
        "primary-bg": "#FEEFE7",
        "text-color-disabled": "#B1B4B6"
      },
      "error": "#D4351C",
      "error-dark": "#B91900",
      "grey": {
        "bg": "#E3E3E3",
        "dark": "#9E9E9E",
        "disabled": "#C5C5C5",
        "light": "#FAFAFA",
        "lighter": "#F0F0F0",
        "mid": "#EEEEEE"
      },
      "info-dark": "#0057BD",
      "input-border": "#464646",
      "link": {
        "hover": "#003078",
        "normal": "#1D70B8"
      },
      "primary": {
        "accent": "#F47738",
        "dark": "#C8602B",
        "light": "#F18F5E",
        "main": "#c84c0e",
        "selected-bg": "#FBEEE8"
      },
      "secondary": "#22394D",
      "success": "#00703C",
      "text": {
        "heading": "#363636",
        "muted": "#787878",
        "primary": "#0B0C0C",
        "secondary": "#505A5F"
      },
      "warning-dark": "#9E5F00"
    },
  },
  {
    id: 'green-gold',
    label: 'Green and Gold',
    swatch: '#204F37',
    version: '1',
    colors: {
      "border": "#D6D5D4",
      "digitv2": {
        "alert-error-bg": "#FEF1F2",
        "alert-info": "#2A5084",
        "alert-info-bg": "#EAF1F5",
        "alert-success-bg": "#E0F2E1",
        "chart-1": "#204F37",
        "chart-2": "#FEC931",
        "chart-3": "#2A5084",
        "chart-4": "#E02D3C",
        "chart-5": "#128F21",
        "header-sidenav": "#204F37",
        "primary-bg": "#FFF4D6",
        "text-color-disabled": "#B1B4B6"
      },
      "error": "#E02D3A",
      "error-dark": "#8B0000",
      "grey": {
        "bg": "#E6E6E6",
        "dark": "#787878",
        "disabled": "#C5C5C5",
        "light": "#FAFAFA",
        "lighter": "#F2F2F2",
        "mid": "#EEEEEE"
      },
      "info-dark": "#2A5084",
      "input-border": "#E1E6EF",
      "link": {
        "hover": "#204F37",
        "normal": "#204F37"
      },
      "primary": {
        "accent": "#204F37",
        "dark": "#204F37",
        "light": "#FFF4D6",
        "main": "#FEC931",
        "selected-bg": "#FFF4D6"
      },
      "secondary": "#1D2433",
      "success": "#128F21",
      "text": {
        "heading": "#204F37",
        "muted": "#787878",
        "primary": "#1D2433",
        "secondary": "#5F5C62"
      },
      "warning-dark": "#9E5F00"
    },
  },
];
