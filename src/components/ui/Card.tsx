import { Box, type BoxProps } from "@radix-ui/themes";
import React from "react";
import { mergeClasses } from "../../lib/utils";

// Shadow preset levels
const shadowPresets = {
  none: "",
  sm: "shadow-[0_0_0_1px_rgba(0,0,0,0.02),_0_1px_4px_rgba(0,0,0,0.02)]",
  md: "shadow-[0_0_0_1px_rgba(0,0,0,0.01),_0_2px_12px_rgba(0,0,0,0.01),_0_4px_24px_rgba(0,0,0,0.01)]",
  lg: "shadow-[0_0_0_1px_rgba(0,0,0,0.03),_0_4px_16px_rgba(0,0,0,0.04),_0_8px_32px_rgba(0,0,0,0.03)]",
  xl: "shadow-[0_0_0_1px_rgba(0,0,0,0.04),_0_8px_24px_rgba(0,0,0,0.06),_0_16px_48px_rgba(0,0,0,0.04)]",
} as const;

type ShadowLevel = keyof typeof shadowPresets;

export type CardProps = BoxProps & {
  /** Shadow intensity level: none, sm, md (default), lg, xl */
  shadow?: ShadowLevel;
};

export const Card: React.FC<CardProps> = ({
  children,
  className = "",
  shadow = "md",
  ...props
}) => (
  <Box
    {...props}
    className={mergeClasses(
      `
        p-5
        bg-[var(--color-panel-solid)]
        rounded-[var(--radius-6)]
      `,
      shadowPresets[shadow],
      className,
    )}
  >
    {children}
  </Box>
);
