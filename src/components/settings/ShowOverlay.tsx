import React from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../hooks/useSettings";
import type { OverlayPosition } from "../../lib/types";
import { ActionWrapper } from "../ui";
import { Dropdown } from "../ui/Dropdown";
import { SettingContainer } from "../ui/SettingContainer";

interface ShowOverlayProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

const getOverlayOptions = (t: any) => [
  { value: "none", label: t("settings.advanced.overlay.options.none") },
  { value: "bottom", label: t("settings.advanced.overlay.options.bottom") },
  { value: "top", label: t("settings.advanced.overlay.options.top") },
  { value: "follow", label: t("settings.advanced.overlay.options.follow") },
];

export const ShowOverlay: React.FC<ShowOverlayProps> = React.memo(
  ({ descriptionMode = "tooltip", grouped = false }) => {
    const { t } = useTranslation();
    const { getSetting, updateSetting, isUpdating } = useSettings();

    const selectedPosition = (getSetting("overlay_position") ||
      "bottom") as OverlayPosition;

    const overlayOptions = getOverlayOptions(t);

    return (
      <SettingContainer
        title={t("settings.advanced.overlay.title")}
        description={t("settings.advanced.overlay.description")}
        descriptionMode={descriptionMode}
        grouped={grouped}
      >
        <ActionWrapper>
          <Dropdown
            options={overlayOptions}
            selectedValue={selectedPosition}
            onSelect={(value) =>
              updateSetting("overlay_position", value as OverlayPosition)
            }
            disabled={isUpdating("overlay_position")}
          />
        </ActionWrapper>
      </SettingContainer>
    );
  },
);
