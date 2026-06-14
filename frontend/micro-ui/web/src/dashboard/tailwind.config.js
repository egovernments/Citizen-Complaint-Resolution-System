/** @type {import('tailwindcss').Config} */
module.exports = {
  prefix: "tw-",
  content: ["./src/dashboard/**/*.{js,jsx}"],
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "Roboto", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      borderRadius: {
        sm: "4px",
      },
      colors: {
        brand: {
          teal: "var(--brand-teal, #0d9488)",
          dark: "var(--brand-dark, #134e4a)",
          slate: "var(--brand-slate, #334155)",
        },
        background: "var(--dashboard-background, #fcfbf8)",
        foreground: "var(--dashboard-foreground, #1b1b1b)",
        surface: "var(--dashboard-surface, #ffffff)",
        border: "var(--dashboard-border, #e8e6e1)",
        muted: {
          DEFAULT: "var(--dashboard-muted, #f0eeea)",
          foreground: "var(--dashboard-muted-foreground, #6b6860)",
        },
        primary: {
          DEFAULT: "var(--brand-teal, #0d9488)",
          foreground: "#ffffff",
        },
        status: {
          resolved: "var(--dashboard-status-resolved, #059669)",
          breach: "var(--dashboard-status-breach, #dc2626)",
        },
      },
    },
  },
  plugins: [],
};
