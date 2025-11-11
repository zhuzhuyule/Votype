import React from "react";
import { SettingContainer } from "./SettingContainer";

interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  label: string;
  description: string;
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
  showValue?: boolean;
  formatValue?: (value: number) => string;
}

export const Slider: React.FC<SliderProps> = ({
  value,
  onChange,
  min,
  max,
  step = 0.01,
  disabled = false,
  label,
  description,
  descriptionMode = "tooltip",
  grouped = false,
  showValue = true,
  formatValue = (v) => v.toFixed(2),
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(parseFloat(e.target.value));
  };

  return (
    <SettingContainer
      title={label}
      description={description}
      descriptionMode={descriptionMode}
      grouped={grouped}
      layout="horizontal"
      disabled={disabled}
    >
      <div className="w-full">
        <div className="flex items-center space-x-2 h-6">
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={handleChange}
            disabled={disabled}
            className="flex-grow h-1.5 rounded-full appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-logo-primary/40 disabled:opacity-50 disabled:cursor-not-allowed bg-mid-gray/10"
            style={{
              background: `linear-gradient(to right, var(--color-logo-primary) ${
                ((value - min) / (max - min)) * 100
              }%, rgb(128, 128, 128, 0.1) ${
                ((value - min) / (max - min)) * 100
              }%)`,
            }}
          />
          {showValue && (
            <span className="text-sm font-normal text-text/80 min-w-12 text-right">
              {formatValue(value)}
            </span>
          )}
        </div>
      </div>
    </SettingContainer>
  );
};
