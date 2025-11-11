/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Semantic colors from CSS variables
        text: "var(--color-text)",
        "text-secondary": "var(--color-text-secondary)",
        "text-tertiary": "var(--color-text-tertiary)",
        background: "var(--color-background)",
        surface: "var(--color-surface)",
        card: "var(--color-card)",
        border: "var(--color-border)",
        "border-strong": "var(--color-border-strong)",

        // Accent colors (theme-aware)
        accent: "var(--color-accent)",
        "accent-50": "var(--color-accent-50)",
        "accent-100": "var(--color-accent-100)",
        "accent-200": "var(--color-accent-200)",
        "accent-300": "var(--color-accent-300)",
        "accent-400": "var(--color-accent-400)",
        "accent-500": "var(--color-accent-500)",
        "accent-600": "var(--color-accent-600)",
        "accent-700": "var(--color-accent-700)",
        "accent-800": "var(--color-accent-800)",
        "accent-900": "var(--color-accent-900)",

        // Legacy colors (keep for compatibility)
        "logo-primary": "var(--color-logo-primary)",
        "logo-stroke": "var(--color-logo-stroke)",
        "text-stroke": "var(--color-text-stroke)",
        "mid-gray": "var(--color-mid-gray)",

        // Status colors
        success: "#10B981",
        error: "#EF4444",
        warning: "#F59E0B",
        info: "#3B82F6",
      },
      spacing: {
        xs: "4px",
        sm: "8px",
        md: "12px",
        lg: "16px",
        xl: "24px",
        "2xl": "32px",
        "3xl": "48px",
        "4xl": "64px",
      },
      borderRadius: {
        none: "0px",
        xs: "4px",
        sm: "6px",
        md: "8px",
        lg: "12px",
      },
      boxShadow: {
        xs: "0 1px 2px rgba(0,0,0,0.04)",
        sm: "0 2px 4px rgba(0,0,0,0.06), 0 1px 1px rgba(0,0,0,0.04)",
        md: "0 4px 8px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.04)",
        lg: "0 10px 20px rgba(0,0,0,0.12), 0 4px 8px rgba(0,0,0,0.08)",
        xl: "0 20px 40px rgba(0,0,0,0.16), 0 8px 16px rgba(0,0,0,0.12)",
      },
      animation: {
        "spin-slow": "spin 1.2s linear infinite",
        "pulse-soft": "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
    },
  },
  plugins: [],
};
