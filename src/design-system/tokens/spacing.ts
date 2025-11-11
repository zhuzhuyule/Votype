/**
 * Design System - Spacing Tokens
 * Consistent spacing scale for layouts and components
 */

export const spacing = {
  // Base units
  xs: "0.25rem", // 4px
  sm: "0.5rem", // 8px
  md: "1rem", // 16px
  lg: "1.5rem", // 24px
  xl: "2rem", // 32px
  "2xl": "2.5rem", // 40px
  "3xl": "3rem", // 48px

  // Aliases for common use cases
  gutter: "1rem",
  section: "1.5rem",
} as const;

export type SpacingToken = typeof spacing;
