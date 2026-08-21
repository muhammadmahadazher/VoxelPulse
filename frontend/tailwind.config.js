/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        void: "#0a0b10",
        cyan: "#00F5FF",
        violet: "#7000FF",
      },
    },
  },
  plugins: [],
};
