import React, { useState } from "react";
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
  const [isDragging, setIsDragging] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(parseFloat(e.target.value));
  };

  const percentage = ((value - min) / (max - min)) * 100;

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
        <div className="flex items-center space-x-3 h-6">
          <div className="flex-grow relative group">
            <input
              type="range"
              min={min}
              max={max}
              step={step}
              value={value}
              onChange={handleChange}
              onMouseDown={() => setIsDragging(true)}
              onMouseUp={() => setIsDragging(false)}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              disabled={disabled}
              className={`w-full h-2 rounded-lg appearance-none cursor-pointer transition-all duration-200 ${
                disabled
                  ? "opacity-50 cursor-not-allowed"
                  : "hover:h-2.5 focus:h-2.5"
              } focus:outline-none ${isFocused || isDragging ? "ring-2 ring-logo-primary ring-offset-2 ring-offset-background" : ""}`}
              style={{
                background: `linear-gradient(to right, var(--color-background-ui) ${percentage}%, rgba(128, 128, 128, 0.2) ${percentage}%)`,
              }}
            />
            {(isDragging || isFocused) && (
              <div
                className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-background-ui rounded-full shadow-lg pointer-events-none transition-all duration-200 animate-in fade-in zoom-in-75"
                style={{ left: `calc(${percentage}% - 8px)` }}
              />
            )}
          </div>
          {showValue && (
            <span
              className={`text-sm font-semibold min-w-12 text-right transition-all duration-200 ${
                isDragging || isFocused
                  ? "text-logo-primary scale-110"
                  : "text-text/90"
              }`}
            >
              {formatValue(value)}
            </span>
          )}
        </div>
      </div>
    </SettingContainer>
  );
};
