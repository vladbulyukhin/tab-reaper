/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,js,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "#FF4C4C",
        "primary-5": "rgba(255,76,76,0.05)",
        dark: "#2E2E2E",
        light: "#F8F8F8",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui"],
      },
    },
  },
  plugins: [],
};
