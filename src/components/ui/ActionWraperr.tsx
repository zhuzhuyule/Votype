import React from "react";
import { Flex, type FlexProps } from "@radix-ui/themes";
import { ResetButton } from "./ResetButton";
import { mergeClasses, sx } from "../../lib/utils/classTool";

type ResetButtonConfig = {
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  children?: React.ReactNode;
  size?: "sm" | "md" | "lg";
  variant?: "primary" | "secondary" | "danger" | "ghost";
};

interface ActionWrapperProps extends Omit<FlexProps, "children"> {
  children: React.ReactNode;
  onReset?: () => void;
  resetProps?: ResetButtonConfig;
}

export const ActionWrapper: React.FC<ActionWrapperProps> = ({
  children,
  onReset,
  resetProps,
  direction,
  align = "center",
  justify = "center",
  gap = "2",
  ...flexProps
}) => {
  return (
    <Flex
      direction={direction}
      align={align}
      justify={justify}
      width={"260px"}
      gap={gap}
      {...flexProps}
      className={mergeClasses(
        sx({
          "& > :first-child": { flex: 1 },
        }),
        flexProps.className,
      )}
    >
      {children}
      {onReset && <ResetButton onClick={onReset} {...resetProps} />}
    </Flex>
  );
};
