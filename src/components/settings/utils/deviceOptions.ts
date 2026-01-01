import { AudioDevice } from "../../../lib/types";
import { DropdownOption } from "../../ui/Dropdown";

export const normalizeDeviceValue = (value?: string | null): string => {
  if (!value) return "Default";
  return value.toLowerCase() === "default" ? "Default" : value;
};

export const toDeviceDropdownOptions = (
  devices: AudioDevice[],
  defaultLabel: string,
): DropdownOption[] =>
  devices.map((device) => {
    const value = normalizeDeviceValue(device.name);
    const isDefault = device.is_default || value === "Default";

    return {
      value,
      label: isDefault ? defaultLabel : device.name,
    };
  });
