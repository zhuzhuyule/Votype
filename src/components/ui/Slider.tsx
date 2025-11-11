import React from "react";
import * as RadixSlider from "@radix-ui/react-slider";
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
  const handleValueChange = (values: number[]) => {
    onChange(values[0]);
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
      <div className="w-full min-w-0">
        <div className="flex items-center space-x-3">
          <div className="flex-1 min-w-0">
            <RadixSlider.Root
              className={`relative flex items-center select-none touch-none h-5 w-full ${
                disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
              }`}
              value={[value]}
              onValueChange={handleValueChange}
              min={min}
              max={max}
              step={step}
              disabled={disabled}
            >
              <RadixSlider.Track className="relative bg-mid-gray/20 grow rounded-full h-1">
                <RadixSlider.Range className="absolute bg-logo-primary/90 rounded-full h-full" />
              </RadixSlider.Track>
              <RadixSlider.Thumb
                className="block w-4 h-4 bg-white border-2 border-logo-primary/90 rounded-full shadow hover:bg-logo-primary/10 focus:outline-none focus:ring-2 focus:ring-logo-primary focus:ring-offset-2 transition-all duration-200"
                aria-label={label}
              />
            </RadixSlider.Root>
          </div>
          {showValue && (
            <span className="text-sm font-medium text-text/90 min-w-10 text-right flex-shrink-0">
              {formatValue(value)}
            </span>
          )}
        </div>
      </div>
    </SettingContainer>
  );
};
