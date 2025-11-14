import React from "react";
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
  return (
    <SettingContainer
      title="Debug Paths"
      description="Display internal file paths and directories for debugging purposes"
      descriptionMode={descriptionMode}
      grouped={grouped}
    >
      <ActionWrapper>
        <div className="text-sm text-gray-600 space-y-2">
          <div>
            <span className="font-medium">App Data:</span>{" "}
            <span className="font-mono text-xs">%APPDATA%/handy</span>
          </div>
          <div>
            <span className="font-medium">Models:</span>{" "}
            <span className="font-mono text-xs">%APPDATA%/handy/models</span>
          </div>
          <div>
            <span className="font-medium">Settings:</span>{" "}
            <span className="font-mono text-xs">
              %APPDATA%/handy/settings_store.json
            </span>
          </div>
        </div>
      </ActionWrapper>
    </SettingContainer>
  );
};
