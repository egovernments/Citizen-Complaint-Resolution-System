/** @type {import('tailwindcss').Config} */
module.exports = {
  prefix: "tw-",
  content: ["./src/dashboard/**/*.{js,jsx}"],
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        brand: {
          teal: "var(--brand-teal, #0d9488)",
          dark: "var(--brand-dark, #134e4a)",
          slate: "var(--brand-slate, #334155)",
        },
      },
    },
  },
  plugins: [],
};
