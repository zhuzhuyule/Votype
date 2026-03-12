import { Flex, Slider, Text } from "@radix-ui/themes";
import React, { useEffect, useState } from "react";
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
  const [localLimit, setLocalLimit] = useState(
    settings?.post_process_context_limit ?? 3,
  );

  useEffect(() => {
    if (settings) {
      setLocalLimit(settings.post_process_context_limit);
    }
  }, [settings?.post_process_context_limit]);

  if (!settings) return null;

  return (
    <Flex direction="column" className={grouped ? "" : "p-4"}>
      <SettingContainer
        title={t("settings.postProcessing.inputInjection.title")}
        description={t("settings.postProcessing.inputInjection.description")}
        descriptionMode={descriptionMode}
        grouped={grouped}
      >
        <Flex direction="column" gap="2" className="w-full">
          <ToggleSwitch
            checked={settings.post_process_context_enabled}
            onChange={(checked) =>
              updateSetting("post_process_context_enabled", checked)
            }
            isUpdating={isUpdating("post_process_context_enabled")}
            label={t("settings.postProcessing.inputInjection.history.enabled")}
            description={t(
              "settings.postProcessing.inputInjection.history.description",
            )}
            descriptionMode={descriptionMode}
            grouped={false}
          />

          {settings.post_process_context_enabled && (
            <SettingContainer
              title={t("settings.postProcessing.inputInjection.history.limit")}
              description={t(
                "settings.postProcessing.inputInjection.history.limitDesc",
                {
                  count: localLimit,
                },
              )}
              descriptionMode={descriptionMode}
              grouped={false}
            >
              <Flex align="center" gap="3" style={{ width: "220px" }}>
                <Slider
                  value={[localLimit]}
                  min={1}
                  max={30}
                  step={1}
                  onValueChange={([val]) => setLocalLimit(val)}
                  onValueCommit={([val]) =>
                    updateSetting("post_process_context_limit", val)
                  }
                  className="flex-1"
                />
                <Text size="1" color="gray" style={{ minWidth: "24px" }}>
                  {localLimit}
                </Text>
              </Flex>
            </SettingContainer>
          )}

          <ToggleSwitch
            checked={settings.post_process_streaming_output_enabled}
            onChange={(checked) =>
              updateSetting("post_process_streaming_output_enabled", checked)
            }
            isUpdating={isUpdating("post_process_streaming_output_enabled")}
            label={t(
              "settings.postProcessing.inputInjection.streaming.enabled",
            )}
            description={t(
              "settings.postProcessing.inputInjection.streaming.description",
            )}
            descriptionMode={descriptionMode}
            grouped={false}
          />

          <ToggleSwitch
            checked={settings.post_process_hotword_injection_enabled}
            onChange={(checked) =>
              updateSetting("post_process_hotword_injection_enabled", checked)
            }
            isUpdating={isUpdating("post_process_hotword_injection_enabled")}
            label={t("settings.postProcessing.inputInjection.hotwords.enabled")}
            description={t(
              "settings.postProcessing.inputInjection.hotwords.description",
            )}
            descriptionMode={descriptionMode}
            grouped={false}
          />
        </Flex>
      </SettingContainer>
    </Flex>
  );
};
