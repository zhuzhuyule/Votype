import {
  Button,
  ButtonProps,
  Flex,
  IconButton,
  type FlexProps,
} from "@radix-ui/themes";
import React from "react";
import { mergeClasses, sx } from "../../lib/utils/classTool";
import ResetIcon from "../icons/ResetIcon";

interface ActionWrapperProps extends Omit<FlexProps, "children"> {
  children: React.ReactNode;
  onReset?: () => void;
  resetProps?: ButtonProps;
}

export const ActionWrapper: React.FC<ActionWrapperProps> = ({
  children,
  onReset,
  resetProps,
  direction,
  align = "center",
  justify = "center",
  gap = "3",
  ...flexProps
}) => {
  return (
    <Flex
      direction={direction}
      align={align}
      justify={justify}
      gap={gap}
      {...flexProps}
      className={mergeClasses(
        sx({
          "& > :first-child": { flex: 1 },
        }),
        "w-70",
        flexProps.className,
      )}
    >
      {children}
      {onReset && (
        <IconButton variant="ghost" {...resetProps} onClick={onReset}>
          <ResetIcon />
        </IconButton>
      )}
    </Flex>
  );
};
