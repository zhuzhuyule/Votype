import { type as getOsType } from "@tauri-apps/plugin-os";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../hooks/useSettings";
import type { PasteMethod } from "../../lib/types";
import { ActionWrapper } from "../ui";
import { Dropdown } from "../ui/Dropdown";
import { SettingContainer } from "../ui/SettingContainer";

interface PasteMethodProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

const getPasteMethodOptions = (osType: string, t: any) => {
  const options = [
    { value: "ctrl_v", label: t("pasteMethod.ctrlV") },
    { value: "direct", label: t("pasteMethod.direct") },
    { value: "none", label: t("pasteMethod.disabled") },
  ];

  // Add Shift+Insert and Ctrl+Shift+V options for Windows and Linux only
  if (osType === "windows" || osType === "linux") {
    options.push({
      value: "ctrl_shift_v",
      label: "Clipboard (Ctrl+Shift+V)",
    });
    options.push({
      value: "shift_insert",
      label: t("pasteMethod.shiftInsert"),
    });
  }

  return options;
};

export const PasteMethodSetting: React.FC<PasteMethodProps> = React.memo(
  ({ descriptionMode = "tooltip", grouped = false }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();
    const [osType, setOsType] = useState<string>("unknown");

    useEffect(() => {
      setOsType(getOsType());
    }, []);

    const selectedMethod = (getSetting("paste_method") ||
      "ctrl_v") as PasteMethod;

    const pasteMethodOptions = getPasteMethodOptions(osType, t);

    return (
      <SettingContainer
        title={t("pasteMethod.title")}
        description={t("pasteMethod.description")}
        descriptionMode={descriptionMode}
        grouped={grouped}
        tooltipPosition="bottom"
      >
        <ActionWrapper>
          <Dropdown
            options={pasteMethodOptions}
            selectedValue={selectedMethod}
            onSelect={(value) =>
              updateSetting("paste_method", value as PasteMethod)
            }
            disabled={isUpdating("paste_method")}
          />
        </ActionWrapper>
      </SettingContainer>
    );
  },
);
