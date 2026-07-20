import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        studio: {
          primary: "#0F9F8F",
          primaryHover: "#0F766E",
          navy: "#0B1736",
          ink: "#10203F",
          mutedText: "#475569",
          darkBg: "#0B1736",
          panelBg: "#F8FAFC",
          border: "#CBD5E1",
          success: "#10B981",
          warning: "#F59E0B",
          danger: "#EF4444",
        },
      },
      boxShadow: {
        panel: "0 14px 36px rgba(15, 23, 42, 0.06)",
      },
      gridTemplateColumns: {
        workstation: "232px minmax(0, 1fr)",
      },
    },
  },
  plugins: [],
} satisfies Config;
