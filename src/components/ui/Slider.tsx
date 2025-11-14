import React from "react";
import { SettingContainer } from "./SettingContainer";
import { ActionWrapper } from "./ActionWraperr";
import { Slider as RadixSlider, Text } from "@radix-ui/themes";

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
      <ActionWrapper>
        <RadixSlider
          value={[value]}
          onValueChange={handleValueChange}
          size="1"
          min={min}
          max={max}
          step={step}
          disabled={disabled}
        />
        {showValue && <Text size="1" className="block w-10 text-right">{formatValue(value)}</Text>}
      </ActionWrapper>
    </SettingContainer>
  );
};
