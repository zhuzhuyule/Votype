import React from "react";
import { Switch } from "@headlessui/react";
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
      <Switch
        checked={checked}
        onChange={onChange}
        disabled={disabled || isUpdating}
        className={`group relative inline-flex h-6 w-11 items-center rounded-full transition-all duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-logo-primary focus:ring-offset-2 focus:ring-offset-background ${
          checked ? "bg-background-ui" : "bg-mid-gray/20"
        } ${disabled || isUpdating ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:shadow-md"}`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition-all duration-200 ease-in-out ${
            checked ? "translate-x-5" : "translate-x-0.5"
          } ${!disabled && !isUpdating && "group-hover:scale-110"}`}
        />
      </Switch>
      {isUpdating && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-4 h-4 border-2 border-logo-primary border-t-transparent rounded-full animate-spin"></div>
        </div>
      )}
    </SettingContainer>
  );
};
