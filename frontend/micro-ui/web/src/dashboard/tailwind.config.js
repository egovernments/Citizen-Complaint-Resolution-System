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
        bomet: {
          teal: "#0d9488",
          dark: "#134e4a",
          slate: "#334155",
        },
      },
    },
  },
  plugins: [],
};
