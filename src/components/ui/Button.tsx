import { Button as RadixButton, type ButtonProps as ThemeButtonProps } from "@radix-ui/themes";
import React from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "featured";
type ButtonSize = "sm" | "md";

const variantMap: Record<ButtonVariant, ThemeButtonProps["variant"]> = {
  primary: "solid",
  secondary: "outline",
  ghost: "ghost",
  danger: "ghost",
  featured: "solid",
};

const colorMap: Record<ButtonVariant, ThemeButtonProps["color"]> = {
  primary: "pink",
  secondary: "gray",
  ghost: "gray",
  danger: "red",
  featured: "pink",
};

const sizeMap: Record<ButtonSize, ThemeButtonProps["size"]> = {
  sm: "1",
  md: "2",
};

type ButtonProps = Omit<
  ThemeButtonProps,
  "variant" | "size" | "color"
> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  color?: ThemeButtonProps["color"];
};

export const Button: React.FC<ButtonProps> = ({
  variant = "primary",
  size,
  color,
  ...props
}) => {
  const resolvedVariant = variantMap[variant] ?? "solid";
  const resolvedSize = size ? sizeMap[size] : undefined;
  const resolvedColor = color ?? colorMap[variant];

  return (
    <RadixButton
      variant={resolvedVariant}
      size={resolvedSize}
      color={resolvedColor}
      {...props}
    />
  );
};
