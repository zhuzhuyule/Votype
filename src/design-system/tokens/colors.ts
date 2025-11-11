/**
 * Design System - Color Tokens
 * Central color definitions for consistent theming
 */

export const colors = {
  // Base colors from CSS variables
  text: "var(--color-text)",
  background: "var(--color-background)",
  "logo-primary": "var(--color-logo-primary)",
  "logo-stroke": "var(--color-logo-stroke)",
  "text-stroke": "var(--color-text-stroke)",

  // Semantic colors
  border: "rgb(var(--color-mid-gray, 128 128 128) / 20%)",
  "border-hover": "rgb(var(--color-mid-gray, 128 128 128) / 50%)",
  "bg-subtle": "rgb(var(--color-mid-gray, 128 128 128) / 5%)",
  "bg-hover": "rgb(var(--color-mid-gray, 128 128 128) / 10%)",
  "bg-active": "rgb(var(--color-logo-primary, 66 153 225) / 10%)",
  "bg-success": "rgb(34 197 94 / 0.1)",
  "bg-error": "rgb(239 68 68 / 0.1)",
  "bg-warning": "rgb(245 158 11 / 0.1)",

  // Text colors
  "text-muted": "rgb(var(--color-mid-gray, 128 128 128) / 65%)",
  "text-subtle": "rgb(var(--color-mid-gray, 128 128 128) / 50%)",
  "text-disabled": "rgb(var(--color-mid-gray, 128 128 128) / 40%)",

  // Status colors
  success: "rgb(34 197 94)",
  error: "rgb(239 68 68)",
  warning: "rgb(245 158 11)",
  info: "var(--color-logo-primary)",
} as const;

export type ColorToken = typeof colors;
