import React from "react";
import { Flex, Text } from "@radix-ui/themes";
import { useTranslation } from "react-i18next";
import { ToggleSwitch } from "../../ui/ToggleSwitch";
import { useSettings } from "../../../hooks/useSettings";

type ChannelKey =
  | "debug_log_post_process"
  | "debug_log_skill_routing"
  | "debug_log_routing"
  | "debug_log_transcription";

const CHANNELS: {
  key: ChannelKey;
  labelKey: string;
  descKey: string;
}[] = [
  {
    key: "debug_log_post_process",
    labelKey: "settings.debug.logChannels.postProcess",
    descKey: "settings.debug.logChannels.postProcessDesc",
  },
  {
    key: "debug_log_skill_routing",
    labelKey: "settings.debug.logChannels.skillRouting",
    descKey: "settings.debug.logChannels.skillRoutingDesc",
  },
  {
    key: "debug_log_routing",
    labelKey: "settings.debug.logChannels.routing",
    descKey: "settings.debug.logChannels.routingDesc",
  },
  {
    key: "debug_log_transcription",
    labelKey: "settings.debug.logChannels.transcription",
    descKey: "settings.debug.logChannels.transcriptionDesc",
  },
];

export const DebugLogChannels: React.FC = React.memo(() => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating } = useSettings();

  return (
    <Flex direction="column" gap="1">
      <Text size="2" weight="medium" className="text-gray-11 mb-1">
        {t("settings.debug.logChannels.title")}
      </Text>
      {CHANNELS.map(({ key, labelKey, descKey }) => (
        <ToggleSwitch
          key={key}
          checked={(getSetting(key) as boolean) || false}
          onChange={(enabled: boolean) => updateSetting(key, enabled)}
          isUpdating={isUpdating(key)}
          label={t(labelKey)}
          description={t(descKey)}
          descriptionMode="inline"
          grouped={true}
        />
      ))}
    </Flex>
  );
});
