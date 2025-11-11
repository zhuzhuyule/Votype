/**
 * Design System - Typography Tokens
 * Consistent typography scales for headings, body, and labels
 */

export const typography = {
  heading: {
    xl: {
      size: "1.875rem", // 30px
      weight: 700,
      lineHeight: 1.2,
    },
    lg: {
      size: "1.5rem", // 24px
      weight: 700,
      lineHeight: 1.25,
    },
    md: {
      size: "1.25rem", // 20px
      weight: 600,
      lineHeight: 1.3,
    },
    sm: {
      size: "1rem", // 16px
      weight: 600,
      lineHeight: 1.4,
    },
  },
  body: {
    lg: {
      size: "1.0625rem", // 17px
      weight: 400,
      lineHeight: 1.6,
    },
    md: {
      size: "0.9375rem", // 15px
      weight: 400,
      lineHeight: 1.5,
    },
    sm: {
      size: "0.875rem", // 14px
      weight: 400,
      lineHeight: 1.5,
    },
    xs: {
      size: "0.8125rem", // 13px
      weight: 400,
      lineHeight: 1.4,
    },
  },
  label: {
    sm: {
      size: "0.75rem", // 12px
      weight: 500,
      lineHeight: 1.2,
      textTransform: "uppercase" as const,
      letterSpacing: "0.05em",
    },
    xs: {
      size: "0.6875rem", // 11px
      weight: 600,
      lineHeight: 1.2,
      textTransform: "uppercase" as const,
      letterSpacing: "0.1em",
    },
  },
} as const;

export type TypographyToken = typeof typography;
