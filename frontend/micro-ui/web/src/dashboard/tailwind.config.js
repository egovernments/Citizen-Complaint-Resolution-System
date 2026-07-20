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
        // All values resolve to the canonical palette defined on
        // `.dashboard-root` in styles/input.css.
        background: "var(--background)",
        foreground: "var(--foreground)",
        surface: {
          DEFAULT: "var(--surface)",
          2: "var(--surface-2)",
          3: "var(--surface-3)",
        },
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)",
        },
        popover: {
          DEFAULT: "var(--popover)",
          foreground: "var(--popover-foreground)",
        },
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          foreground: "var(--accent-foreground)",
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "var(--destructive-foreground)",
        },
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        chrome: {
          DEFAULT: "var(--chrome)",
          foreground: "var(--chrome-foreground)",
          muted: "var(--chrome-muted)",
        },
        status: {
          open: "var(--status-open)",
          "open-bg": "var(--status-open-bg)",
          assigned: "var(--status-assigned)",
          "assigned-bg": "var(--status-assigned-bg)",
          progress: "var(--status-progress)",
          "progress-bg": "var(--status-progress-bg)",
          resolved: "var(--status-resolved)",
          "resolved-bg": "var(--status-resolved-bg)",
          rejected: "var(--status-rejected)",
          "rejected-bg": "var(--status-rejected-bg)",
          overdue: "var(--status-overdue)",
          "overdue-bg": "var(--status-overdue-bg)",
          breach: "var(--status-breach)",
          "breach-bg": "var(--status-breach-bg)",
        },
        chart: {
          1: "var(--chart-1)",
          2: "var(--chart-2)",
          3: "var(--chart-3)",
          4: "var(--chart-4)",
          5: "var(--chart-5)",
        },
        // Legacy brand.* aliases mapped onto the palette.
        brand: {
          teal: "var(--primary)",
          dark: "var(--chrome)",
          slate: "var(--chrome-muted)",
        },
      },
    },
  },
  plugins: [],
};
