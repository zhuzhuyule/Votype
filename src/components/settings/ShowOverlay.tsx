import React from "react";
import { useTranslation } from "react-i18next";
import { Dropdown } from "../ui/Dropdown";
import { SettingContainer } from "../ui/SettingContainer";
import { useSettings } from "../../hooks/useSettings";
import type { OverlayPosition } from "../../lib/types";
import { ActionWrapper } from "../ui";

interface ShowOverlayProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

const getOverlayOptions = (t: any) => [
  { value: "none", label: t("overlayPosition.none") },
  { value: "bottom", label: t("overlayPosition.bottom") },
  { value: "top", label: t("overlayPosition.top") },
  { value: "follow", label: t("overlayPosition.follow") },
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
        title={t("overlayPosition.title")}
        description={t("overlayPosition.description")}
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
