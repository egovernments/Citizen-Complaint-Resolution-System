/**
 * A port of digit-ui-esbuild/src/theme/applyTheme.js.
 *
 * The Keycloak login screens have to paint exactly what digit-ui paints for
 * the same tenant, so the MDMS `common-masters.ThemeConfig` record is turned
 * into CSS custom properties by the same rules: v1 nested groups flattened,
 * v2 semantic fan-out, v3 designer 1:1 fan-out (v3 > v2 > v1 on overlap), the
 * v3 backfill for older records, the button-state fill and the WCAG-judged
 * button foreground. Keep this file in step with the original.
 *
 * Differences from the original, all mechanical:
 * - validation is `validateThemeConfig` (a JSON-schema subset evaluator over
 *   the same schema.json) instead of Ajv, to keep Ajv out of the login bundle;
 * - `computeThemeVars` is split out as a pure function so it can be tested
 *   without a DOM, and nothing is logged.
 */
import schema from "./schema.json";
import { validateAgainstSchema } from "./validateSchema";

export type ThemeConfig = {
    version?: string;
    name?: string;
    code?: string;
    colors?: Record<string, unknown>;
    [key: string]: unknown;
};

// v2 → CSS var(s).
export const SEMANTIC_EXPANSION: Record<string, string[]> = {
    brand: ["--color-primary-main"],
    "brand-on": [
        "--color-primary-dark",
        "--color-primary-accent",
        "--color-link-normal",
        "--color-link-hover",
        "--color-text-heading"
    ],
    "surface-header": ["--color-secondary", "--color-digitv2-header-sidenav"],
    "surface-page": ["--color-grey-light"],
    "text-primary": ["--color-text-primary"],
    "text-secondary": ["--color-text-secondary", "--color-text-muted"],
    "text-muted": ["--color-text-muted"],
    "text-disabled": ["--color-grey-disabled", "--color-digitv2-text-color-disabled"],
    border: ["--color-border", "--color-input-border"],
    error: ["--color-error", "--color-error-dark"],
    success: ["--color-success"],
    info: ["--color-digitv2-alert-info", "--color-info-dark"],
    warning: ["--color-warning-dark"],
    "selected-bg": ["--color-primary-selected-bg", "--color-digitv2-primary-bg"]
};

// v3 → CSS var(s).
export const V3_EXPANSION: Record<string, string[]> = {
    "primary-1": [
        "--color-primary-1",
        "--color-primary-dark",
        "--color-primary-accent",
        "--color-link-normal",
        "--color-link-hover",
        "--color-text-heading",
        "--color-secondary",
        "--color-digitv2-header-sidenav"
    ],
    "primary-2": ["--color-primary-2", "--color-primary-main"],
    "primary-1-bg": ["--color-primary-1-bg", "--color-primary-selected-bg", "--color-digitv2-primary-bg"],
    "primary-2-bg": ["--color-primary-2-bg"],
    "text-heading": ["--color-text-heading"],
    "text-primary": ["--color-text-primary"],
    "text-secondary": ["--color-text-secondary", "--color-text-muted"],
    "text-muted": ["--color-text-muted"],
    "text-disabled": ["--color-text-disabled", "--color-grey-disabled", "--color-digitv2-text-color-disabled"],
    "page-bg": ["--color-page-bg"],
    "page-secondary-bg": [
        "--color-page-secondary-bg",
        "--color-grey-light",
        "--color-grey-lighter",
        "--color-grey-bg"
    ],
    "button-primary-bg-default": ["--color-button-primary-bg-default"],
    "button-primary-bg-hover": ["--color-button-primary-bg-hover"],
    "button-primary-bg-pressed": ["--color-button-primary-bg-pressed"],
    "button-primary-text": ["--color-button-primary-text"],
    "button-primary-border": ["--color-button-primary-border"],
    "button-primary-disabled-bg": ["--color-button-primary-disabled-bg"],
    "button-primary-disabled-text": ["--color-button-primary-disabled-text"],
    "button-secondary-bg-default": ["--color-button-secondary-bg-default"],
    "button-secondary-bg-hover": ["--color-button-secondary-bg-hover"],
    "button-secondary-bg-pressed": ["--color-button-secondary-bg-pressed"],
    "button-secondary-text": ["--color-button-secondary-text"],
    "button-secondary-border": ["--color-button-secondary-border"],
    "button-tertiary-text": ["--color-button-tertiary-text", "--color-link-normal", "--color-link-hover"],
    "input-bg": ["--color-input-bg"],
    "input-border-default": ["--color-input-border-default", "--color-input-border"],
    "input-border-focus": ["--color-input-border-focus"],
    "input-border-error": ["--color-input-border-error"],
    "input-placeholder": ["--color-input-placeholder"],
    "input-text": ["--color-input-text"],
    "input-label": ["--color-input-label"],
    "input-helper": ["--color-input-helper"],
    "header-bg": ["--color-header-bg"],
    "header-text": ["--color-header-text"],
    "header-icon": ["--color-header-icon"],
    "sidebar-bg": ["--color-sidebar-bg"],
    "sidebar-text-active": ["--color-sidebar-text-active"],
    "sidebar-text-default": ["--color-sidebar-text-default"],
    "sidebar-hover-text": ["--color-sidebar-hover-text"],
    "sidebar-hover-bg": ["--color-sidebar-hover-bg"],
    "sidebar-icon-active": ["--color-sidebar-icon-active"],
    "sidebar-selected-bg": ["--color-sidebar-selected-bg"],
    "sidebar-selected-text": ["--color-sidebar-selected-text"],
    "card-border": ["--color-card-border", "--color-border"],
    "card-divider": ["--color-card-divider"],
    "card-success": ["--color-card-success"],
    "card-error": ["--color-card-error"],
    "status-success-text": ["--color-status-success-text", "--color-success"],
    "status-success-bg": ["--color-status-success-bg", "--color-digitv2-alert-success-bg"],
    "status-success-border": ["--color-status-success-border"],
    "status-error-text": ["--color-status-error-text", "--color-error", "--color-error-dark"],
    "status-error-bg": ["--color-status-error-bg", "--color-digitv2-alert-error-bg"],
    "status-error-border": ["--color-status-error-border"],
    "status-warning-text": ["--color-status-warning-text", "--color-warning-dark"],
    "status-warning-bg": ["--color-status-warning-bg"],
    "status-warning-border": ["--color-status-warning-border"],
    "status-info-text": ["--color-status-info-text", "--color-info-dark", "--color-digitv2-alert-info"],
    "status-info-bg": ["--color-status-info-bg", "--color-digitv2-alert-info-bg"],
    "status-info-border": ["--color-status-info-border"],
    "table-header-bg": ["--color-table-header-bg"],
    "table-header-text": ["--color-table-header-text"],
    "table-row-bg": ["--color-table-row-bg"],
    "table-alt-row": ["--color-table-alt-row"],
    "table-row-text": ["--color-table-row-text"],
    "table-border": ["--color-table-border"],
    "table-hover": ["--color-table-hover"],
    "table-selected": ["--color-table-selected"],
    "table-hover-text": ["--color-table-hover-text"],
    "table-selected-text": ["--color-table-selected-text"],
    loader: ["--color-loader"],
    progress: ["--color-progress"],
    "tooltip-bg": ["--color-tooltip-bg"],
    "tooltip-text": ["--color-tooltip-text"]
};

function flatten(obj: Record<string, unknown>, prefix: string, out: Record<string, string>) {
    for (const key of Object.keys(obj)) {
        const value = obj[key];
        const next = prefix ? `${prefix}-${key}` : key;
        if (value && typeof value === "object" && !Array.isArray(value)) {
            flatten(value as Record<string, unknown>, next, out);
        } else if (typeof value === "string") {
            out[`--color-${next}`] = value;
        }
    }
}

function hexChannels(hex: unknown): [number, number, number] | null {
    if (typeof hex !== "string") return null;
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return null;
    const h6 = m[1]!.length === 3 ? [...m[1]!].map(c => c + c).join("") : m[1]!;
    return [
        parseInt(h6.slice(0, 2), 16) / 255,
        parseInt(h6.slice(2, 4), 16) / 255,
        parseInt(h6.slice(4, 6), 16) / 255
    ];
}

const WHITE = "#FFFFFF";
const NEAR_BLACK = "#0B0C0C";
const AA_NORMAL_TEXT = 4.5;

export function relativeLuminance(hex: unknown): number | null {
    const ch = hexChannels(hex);
    if (!ch) return null;
    const lin = ch.map(c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
    return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
}

function contrastWithLuminance(l1: number, l2: number) {
    const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
    return (hi + 0.05) / (lo + 0.05);
}

function readableForegroundAcross(hexes: (string | undefined)[]): string | null {
    const lums = hexes.map(relativeLuminance).filter((l): l is number => l !== null);
    if (!lums.length) return null;
    const worst = (fgLum: number) => Math.min(...lums.map(l => contrastWithLuminance(fgLum, l)));
    const white = worst(relativeLuminance(WHITE)!);
    const black = worst(relativeLuminance(NEAR_BLACK)!);
    if (white >= AA_NORMAL_TEXT) return WHITE;
    if (black >= AA_NORMAL_TEXT) return NEAR_BLACK;
    return white >= black ? WHITE : NEAR_BLACK;
}

export function hexToHslTriplet(hex: unknown): string | null {
    const ch = hexChannels(hex);
    if (!ch) return null;
    const [r, g, b] = ch;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0;
    let s = 0;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h /= 6;
    }
    return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

export function validateThemeConfig(config: unknown): config is ThemeConfig {
    return validateAgainstSchema(schema, config);
}

export type ThemeResult = {
    /** CSS custom properties, in the order the original writes them. */
    vars: Record<string, string>;
    /** `data-header-tone` on <html>, or undefined to remove it. */
    headerTone: "dark" | "light" | undefined;
    /** Declarations of the `.v2-scope` bridge rule, empty when none. */
    v2Bridge: string[];
};

/** The whole of applyTheme() minus the DOM writes. Null means "skip apply". */
export function computeThemeVars(config: unknown): ThemeResult | null {
    if (!config || typeof config !== "object" || Array.isArray(config)) return null;
    if (!validateThemeConfig(config)) return null;
    const colors = config.colors as Record<string, unknown> | undefined;
    if (!colors) return null;

    const vars: Record<string, string> = {};

    // Pass 1: v1 flatten.
    flatten(colors, "", vars);

    // Pass 2: v2 semantic expansion, opt-in via colors.brand.
    if (typeof colors.brand === "string") {
        for (const [token, cssVars] of Object.entries(SEMANTIC_EXPANSION)) {
            const value = colors[token];
            if (typeof value === "string") for (const name of cssVars) vars[name] = value;
        }
        const palette = colors["chart-palette"];
        if (Array.isArray(palette)) {
            palette.slice(0, 5).forEach((hex, i) => {
                if (typeof hex === "string") vars[`--color-digitv2-chart-${i + 1}`] = hex;
            });
        }
    }

    // Pass 3: v3 expansion, opt-in via colors["primary-1"]. Wins on overlap.
    const v3Active = typeof colors["primary-1"] === "string";
    if (v3Active) {
        for (const [token, cssVars] of Object.entries(V3_EXPANSION)) {
            const value = colors[token];
            if (typeof value === "string") for (const name of cssVars) vars[name] = value;
        }
        for (let i = 1; i <= 5; i++) {
            const v = colors[`chart-${i}`];
            if (typeof v === "string") vars[`--color-digitv2-chart-${i}`] = v;
        }
    }

    // Pass 4: v3 backfill for v1/v2 records.
    if (!v3Active) {
        const primaryMain = vars["--color-primary-main"];
        const primaryDark = vars["--color-primary-dark"];
        const backfill: Record<string, string | undefined> = {
            "--color-primary-1": primaryDark || primaryMain,
            "--color-primary-2": primaryMain,
            "--color-button-primary-bg-default": primaryMain,
            "--color-button-primary-bg-hover": primaryDark || primaryMain,
            "--color-button-primary-bg-pressed": primaryDark || primaryMain
        };
        for (const [name, value] of Object.entries(backfill)) {
            if (typeof value === "string" && !(name in vars)) vars[name] = value;
        }
    }

    // Pass 5: button states first, then a foreground judged across them.
    const brandSurface =
        vars["--color-button-primary-bg-default"] || vars["--color-primary-2"] || vars["--color-primary-main"];
    if (brandSurface) {
        const deeper = vars["--color-button-primary-bg-hover"] || brandSurface;
        const states: Record<string, string> = {
            "--color-button-primary-bg-default": brandSurface,
            "--color-button-primary-bg-hover": deeper,
            "--color-button-primary-bg-pressed": deeper
        };
        for (const [name, value] of Object.entries(states)) {
            if (!(name in vars)) vars[name] = value;
        }
        if (!("--color-button-primary-text" in vars)) {
            const fg = readableForegroundAcross([
                vars["--color-button-primary-bg-default"],
                vars["--color-button-primary-bg-hover"],
                vars["--color-button-primary-bg-pressed"]
            ]);
            if (fg) vars["--color-button-primary-text"] = fg;
        }
    }

    const headerLum = relativeLuminance(vars["--color-header-bg"]);
    const headerTone =
        headerLum === null
            ? undefined
            : contrastWithLuminance(headerLum, relativeLuminance(WHITE)!) >= AA_NORMAL_TEXT
              ? "dark"
              : "light";

    const v2Bridge: string[] = [];
    const primary = hexToHslTriplet(vars["--color-button-primary-bg-default"] || vars["--color-primary-main"]);
    if (primary) v2Bridge.push(`--v2-primary: ${primary}`, `--v2-ring: ${primary}`);
    const fg = hexToHslTriplet(vars["--color-button-primary-text"]);
    if (fg) v2Bridge.push(`--v2-primary-foreground: ${fg}`);

    return { vars, headerTone, v2Bridge };
}

const V2_BRIDGE_STYLE_ID = "mdms-theme-v2-bridge";

/** Same effect on the document as the original applyTheme(config). */
export function applyTheme(config: unknown, doc: Document = document): boolean {
    const result = computeThemeVars(config);
    if (result === null) return false;
    const root = doc.documentElement;
    for (const [name, value] of Object.entries(result.vars)) {
        root.style.setProperty(name, value);
    }
    if (result.headerTone === undefined) {
        delete root.dataset.headerTone;
    } else {
        root.dataset.headerTone = result.headerTone;
    }
    if (result.v2Bridge.length > 0 && doc.head) {
        let el = doc.getElementById(V2_BRIDGE_STYLE_ID);
        if (!el) {
            el = doc.createElement("style");
            el.id = V2_BRIDGE_STYLE_ID;
            doc.head.appendChild(el);
        }
        el.textContent = `.v2-scope { ${result.v2Bridge.join("; ")}; }`;
    }
    return true;
}
