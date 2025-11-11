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
      <div className="relative inline-flex items-center">
        <RadixSwitch.Root
          className={`inline-flex items-center justify-center h-6 w-11 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-logo-primary focus-visible:ring-offset-2 data-[state=checked]:bg-logo-primary/90 data-[state=unchecked]:bg-mid-gray/30 ${
            disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
          }`}
          checked={checked}
          disabled={disabled || isUpdating}
          onCheckedChange={(state) => onChange(state)}
        >
          <RadixSwitch.Thumb
            className={`block h-5 w-5 bg-white rounded-full shadow transition-transform data-[state=checked]:translate-x-5`}
          />
        </RadixSwitch.Root>
        {isUpdating && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-4 h-4 border-2 border-logo-primary border-t-transparent rounded-full animate-spin"></div>
          </div>
        )}
      </div>
    </SettingContainer>
  );
};
