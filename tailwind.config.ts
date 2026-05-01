import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,html}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["Outfit", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      colors: {
        ink: {
          900: "#08090c",
          800: "#0d0f14",
          700: "#13161d",
          600: "#1c2029",
          500: "#262c38",
          400: "#3a4253",
          300: "#5a6478",
          200: "#8d97aa",
          100: "#c3cad6",
        },
        signal: {
          400: "#86efac",
          500: "#22c55e",
          600: "#16a34a",
        },
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(134,239,172,.4), 0 8px 24px -8px rgba(34,197,94,.4)",
      },
    },
  },
  plugins: [],
} satisfies Config;
