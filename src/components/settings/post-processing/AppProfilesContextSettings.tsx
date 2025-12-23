import { Flex, Slider, Text } from "@radix-ui/themes";
import React from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../../hooks/useSettings";
import { SettingContainer } from "../../ui/SettingContainer";
import { ToggleSwitch } from "../../ui/ToggleSwitch";

interface AppProfilesContextSettingsProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const AppProfilesContextSettings: React.FC<
  AppProfilesContextSettingsProps
> = ({ descriptionMode = "inline", grouped = true }) => {
  const { t } = useTranslation();
  const { settings, updateSetting, isUpdating } = useSettings();

  if (!settings) return null;

  return (
    <Flex direction="column" className={grouped ? "" : "p-4"}>
      <ToggleSwitch
        checked={settings.post_process_context_enabled}
        onChange={(checked) =>
          updateSetting("post_process_context_enabled", checked)
        }
        isUpdating={isUpdating("post_process_context_enabled")}
        label={t("settings.postProcessing.appRules.context.enabled")}
        description={t("settings.postProcessing.appRules.context.description")}
        descriptionMode={descriptionMode}
        grouped={grouped}
      />

      {settings.post_process_context_enabled && (
        <Flex direction="column" className="mt-2">
          <SettingContainer
            title={t("settings.postProcessing.appRules.context.limit")}
            description={t(
              "settings.postProcessing.appRules.context.limitDesc",
              {
                count: settings.post_process_context_limit,
              },
            )}
            descriptionMode={descriptionMode}
            grouped={grouped}
          >
            <Flex align="center" gap="3" style={{ width: "200px" }}>
              <Slider
                value={[settings.post_process_context_limit]}
                min={1}
                max={30}
                step={1}
                onValueChange={([val]) =>
                  updateSetting("post_process_context_limit", val)
                }
                className="flex-1"
              />
              <Text size="1" color="gray" style={{ minWidth: "24px" }}>
                {settings.post_process_context_limit}
              </Text>
            </Flex>
          </SettingContainer>
        </Flex>
      )}
    </Flex>
  );
};
