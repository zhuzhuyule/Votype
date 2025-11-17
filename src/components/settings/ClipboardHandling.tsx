import React from "react";
import { useTranslation } from "react-i18next";
import { Dropdown } from "../ui/Dropdown";
import { SettingContainer } from "../ui/SettingContainer";
import { ActionWrapper } from "../ui/ActionWrapper";
import { useSettings } from "../../hooks/useSettings";
import type { ClipboardHandling } from "../../lib/types";

interface ClipboardHandlingProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

const getClipboardHandlingOptions = (t: any) => [
  { value: "dont_modify", label: t("clipboardHandling.dontModify") },
  { value: "copy_to_clipboard", label: t("clipboardHandling.copyToClipboard") },
];

export const ClipboardHandlingSetting: React.FC<ClipboardHandlingProps> =
  React.memo(({ descriptionMode = "tooltip", grouped = false }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();

    const selectedHandling = (getSetting("clipboard_handling") ||
      "dont_modify") as ClipboardHandling;

    const clipboardHandlingOptions = getClipboardHandlingOptions(t);

    return (
      <SettingContainer
        title={t("clipboardHandling.title")}
        description={t("clipboardHandling.description")}
        descriptionMode={descriptionMode}
        grouped={grouped}
      >
        <ActionWrapper>
          <Dropdown
            options={clipboardHandlingOptions}
            selectedValue={selectedHandling}
            onSelect={(value) =>
              updateSetting("clipboard_handling", value as ClipboardHandling)
            }
            disabled={isUpdating("clipboard_handling")}
          />
        </ActionWrapper>
      </SettingContainer>
    );
  });
