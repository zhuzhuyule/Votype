import React from "react";
import * as RadixSwitch from "@radix-ui/react-switch";
import { SettingContainer } from "./SettingContainer";

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  isUpdating?: boolean;
  label: string;
  description: string;
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
  tooltipPosition?: "top" | "bottom";
}

export const ToggleSwitch: React.FC<ToggleSwitchProps> = ({
  checked,
  onChange,
  disabled = false,
  isUpdating = false,
  label,
  description,
  descriptionMode = "tooltip",
  grouped = false,
  tooltipPosition = "top",
}) => {
  return (
    <SettingContainer
      title={label}
      description={description}
      descriptionMode={descriptionMode}
      grouped={grouped}
      disabled={disabled}
      tooltipPosition={tooltipPosition}
    >
        <RadixSwitch.Root
          className={`relative h-6 w-11 px-0.5 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-offset-2 data-[state=checked]:bg-logo-primary/90 data-[state=unchecked]:bg-mid-gray/30 ${
            disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
          }`}
          checked={checked}
          disabled={disabled || isUpdating}
          onCheckedChange={(state) => onChange(state)}
        >
          <RadixSwitch.Thumb
            className={`block h-5 w-5 bg-white rounded-full transition-transform data-[state=checked]:translate-x-full`}
          />
        </RadixSwitch.Root>
    </SettingContainer>
  );
};
