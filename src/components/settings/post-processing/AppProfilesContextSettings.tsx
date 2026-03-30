import { Box, Button, Flex, Slider, Text, Switch } from "@radix-ui/themes";
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
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
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [localLimit, setLocalLimit] = useState(
    settings?.post_process_context_limit ?? 3,
  );

  useEffect(() => {
    if (settings) {
      setLocalLimit(settings.post_process_context_limit);
    }
  }, [settings?.post_process_context_limit]);

  if (!settings) return null;

  const summary = settings.post_process_context_enabled
    ? t("settings.postProcessing.inputInjection.summaryEnabled", {
        count: localLimit,
      })
    : t("settings.postProcessing.inputInjection.summaryDisabled");

  return (
    <Flex direction="column" className={grouped ? "" : "p-4"}>
      <SettingContainer
        title={t("settings.postProcessing.inputInjection.title")}
        description={summary}
        descriptionMode={descriptionMode}
        grouped={grouped}
      >
        <Flex align="center" gap="2">
          <Button
            variant={showAdvanced ? "solid" : "soft"}
            color={showAdvanced ? "blue" : "gray"}
            size="1"
            onClick={() => setShowAdvanced((prev) => !prev)}
            className="transition-all duration-200"
          >
            {showAdvanced ? (
              <IconChevronDown size={14} />
            ) : (
              <IconChevronRight size={14} />
            )}
            {t("settings.postProcessing.inputInjection.moreOptions")}
          </Button>
          <Switch
            checked={settings.post_process_context_enabled}
            disabled={isUpdating("post_process_context_enabled")}
            onCheckedChange={(checked) =>
              updateSetting("post_process_context_enabled", checked)
            }
            className="data-[state=checked]:bg-logo-primary/90"
          />
        </Flex>
      </SettingContainer>

      <Box
        className={`overflow-hidden transition-all duration-300 ease-in-out ${
          showAdvanced
            ? "max-h-[420px] opacity-100 mt-1"
            : "max-h-0 opacity-0 pointer-events-none"
        }`}
      >
        <Box
          className="ml-5 border-l border-[var(--gray-5)] pl-4"
          style={{ width: "calc(100% - 20px)" }}
        >
          <SettingContainer
            title={t("settings.postProcessing.inputInjection.history.enabled")}
            description={t(
              "settings.postProcessing.inputInjection.history.description",
            )}
            descriptionMode={descriptionMode}
            grouped={false}
          >
            <Switch
              checked={settings.post_process_context_enabled}
              disabled={isUpdating("post_process_context_enabled")}
              onCheckedChange={(checked) =>
                updateSetting("post_process_context_enabled", checked)
              }
              className="data-[state=checked]:bg-logo-primary/90"
            />
          </SettingContainer>

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
        </Box>
      </Box>
    </Flex>
  );
};
