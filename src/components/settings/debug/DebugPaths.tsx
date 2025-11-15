import React from "react";
import { useTranslation } from "react-i18next";
import { SettingContainer } from "../../ui/SettingContainer";
import { ActionWrapper } from "../../ui/ActionWraperr";

interface DebugPathsProps {
  descriptionMode?: "tooltip" | "inline";
  grouped?: boolean;
}

export const DebugPaths: React.FC<DebugPathsProps> = ({
  descriptionMode = "inline",
  grouped = false,
}) => {
  const { t } = useTranslation();
  
  return (
    <SettingContainer
      title={t("debugPaths.title")}
      description={t("debugPaths.description")}
      descriptionMode={descriptionMode}
      grouped={grouped}
    >
      <ActionWrapper>
        <div className="text-sm text-gray-600 space-y-2">
          <div>
            <span className="font-medium">{t("debugPaths.appData")}:</span>{" "}
            <span className="font-mono text-xs">%APPDATA%/handy</span>
          </div>
          <div>
            <span className="font-medium">{t("debugPaths.models")}:</span>{" "}
            <span className="font-mono text-xs">%APPDATA%/handy/models</span>
          </div>
          <div>
            <span className="font-medium">{t("debugPaths.settings")}:</span>{" "}
            <span className="font-mono text-xs">
              %APPDATA%/handy/settings_store.json
            </span>
          </div>
        </div>
      </ActionWrapper>
    </SettingContainer>
  );
};
