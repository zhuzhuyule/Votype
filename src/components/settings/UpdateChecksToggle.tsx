import { Switch } from "@radix-ui/themes";
import { invoke } from "@tauri-apps/api/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../hooks/useSettings";
import { ActionWrapper } from "../ui";
import { SettingContainer } from "../ui/SettingContainer";

interface UpdateChecksToggleProps {
    descriptionMode?: "inline" | "tooltip";
    grouped?: boolean;
}

export const UpdateChecksToggle: React.FC<UpdateChecksToggleProps> = React.memo(
    ({ descriptionMode = "tooltip", grouped = false }) => {
        const { t } = useTranslation();
        const { getSetting, updateSetting, isUpdating } = useSettings();

        const enabled = getSetting("update_checks_enabled") ?? true;

        const handleToggle = async (checked: boolean) => {
            updateSetting("update_checks_enabled", checked);
            try {
                await invoke("change_update_checks_setting", { enabled: checked });
            } catch (error) {
                console.error("Failed to update update checks setting:", error);
            }
        };

        return (
            <SettingContainer
                title={t("settings.debug.updateChecks.label")}
                description={t("settings.debug.updateChecks.description")}
                descriptionMode={descriptionMode}
                grouped={grouped}
            >
                <ActionWrapper>
                    <Switch
                        checked={enabled}
                        onCheckedChange={handleToggle}
                        disabled={isUpdating("update_checks_enabled")}
                    />
                </ActionWrapper>
            </SettingContainer>
        );
    },
);
