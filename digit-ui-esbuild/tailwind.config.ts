import type { Config } from "tailwindcss";

/**
 * Tailwind config for digit-ui-esbuild v2 component layer.
 *
 * Theme tokens are HSL channel triples (e.g. "215 27% 17%") so Tailwind's
 * <color> / <alpha-value> machinery can apply opacity. They read from CSS
 * custom properties wired up in `packages/digit-ui-components-v2/src/theme/tokens.css`,
 * which in turn resolve from MDMS-driven brand vars (--color-text-primary etc.).
 *
 * Net effect: kenya-green tenant ships kenya-green automatically — the v2
 * components never hardcode brand colors.
 */
const config: Config = {
  // Only scan v2 source + the migrated PGR pages — old packages keep their
  // own CSS pipeline, no need to crawl them.
  content: [
    "./packages/digit-ui-components-v2/src/**/*.{ts,tsx}",
    "./products/pgr/src/pages/citizen/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "1rem",
      screens: {
        sm: "640px",
        md: "768px",
        lg: "1024px",
        xl: "1280px",
      },
    },
    extend: {
      colors: {
        background: "hsl(var(--v2-background) / <alpha-value>)",
        foreground: "hsl(var(--v2-foreground) / <alpha-value>)",
        muted: {
          DEFAULT: "hsl(var(--v2-muted) / <alpha-value>)",
          foreground: "hsl(var(--v2-muted-foreground) / <alpha-value>)",
        },
        primary: {
          DEFAULT: "hsl(var(--v2-primary) / <alpha-value>)",
          foreground: "hsl(var(--v2-primary-foreground) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "hsl(var(--v2-accent) / <alpha-value>)",
          foreground: "hsl(var(--v2-accent-foreground) / <alpha-value>)",
        },
        border: "hsl(var(--v2-border) / <alpha-value>)",
        input: "hsl(var(--v2-input) / <alpha-value>)",
        ring: "hsl(var(--v2-ring) / <alpha-value>)",
        destructive: {
          DEFAULT: "hsl(var(--v2-destructive) / <alpha-value>)",
          foreground: "hsl(var(--v2-destructive-foreground) / <alpha-value>)",
        },
        success: {
          DEFAULT: "hsl(var(--v2-success) / <alpha-value>)",
          foreground: "hsl(var(--v2-success-foreground) / <alpha-value>)",
        },
        surface: "hsl(var(--v2-surface) / <alpha-value>)",
      },
      borderRadius: {
        lg: "var(--v2-radius)",
        md: "calc(var(--v2-radius) - 2px)",
        sm: "calc(var(--v2-radius) - 4px)",
      },
      fontFamily: {
        sans: ["Roboto", "system-ui", "-apple-system", "sans-serif"],
      },
      fontSize: {
        xs: ["0.75rem", { lineHeight: "1rem" }],
        sm: ["0.875rem", { lineHeight: "1.25rem" }],
        base: ["1rem", { lineHeight: "1.5rem" }],
        lg: ["1.125rem", { lineHeight: "1.75rem" }],
        xl: ["1.25rem", { lineHeight: "1.75rem" }],
        "2xl": ["1.5rem", { lineHeight: "2rem" }],
        "3xl": ["1.875rem", { lineHeight: "2.25rem" }],
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "slide-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 200ms ease-out",
        "slide-up": "slide-up 240ms ease-out",
      },
    },
  },
  // Scope the v2 layer so it never bleeds across pages still on legacy CSS.
  // Anything inside `.v2-scope` (or its descendants) gets v2 styling; outside
  // pages render exactly as before. We can drop this once the strangler-fig
  // is done.
  important: ".v2-scope",
  corePlugins: {
    preflight: false, // don't reset legacy pages
  },
  plugins: [],
};

export default config;
