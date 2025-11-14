import { ButtonProps, Button as RadixButton } from "@radix-ui/themes";
import React from "react";

export const Button: React.FC<ButtonProps> = ({ ...props }) => {
  return <RadixButton {...props}></RadixButton>;
};
