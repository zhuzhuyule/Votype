import { Flex, Switch, Text, TextField } from "@radix-ui/themes";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../../hooks/useSettings";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { HistoryLimit } from "../HistoryLimit";
import { ModelUnloadTimeoutSetting } from "../ModelUnloadTimeout";
import { RecordingRetentionPeriodSelector } from "../RecordingRetentionPeriod";
import { TranslateToEnglish } from "../TranslateToEnglish";
import { LogDirectory } from "../debug/LogDirectory";
import { LogLevelSelector } from "../debug/LogLevelSelector";
import { OfflineVadRealtimeInterval } from "../debug/OfflineVadRealtimeInterval";
import { OfflineVadRealtimeWindow } from "../debug/OfflineVadRealtimeWindow";
import { DebugLogChannels } from "../debug/DebugLogChannels";
import { WordCorrectionThreshold } from "../debug/WordCorrectionThreshold";

export const AdvancedSettings: React.FC = () => {
  const { t } = useTranslation();
  const { expertMode, settings, setProxySettings } = useSettings();
  const [localProxyUrl, setLocalProxyUrl] = useState(
    settings?.proxy_url ?? "",
  );

  useEffect(() => {
    setLocalProxyUrl(settings?.proxy_url ?? "");
  }, [settings?.proxy_url]);

  const proxyGlobalEnabled = settings?.proxy_global_enabled ?? false;

  return (
    <Flex direction="column" className="max-w-5xl w-full mx-auto space-y-8">
      {/* Network / Proxy */}
      <SettingsGroup title={t("settings.advanced.groups.network", "Network")}>
        <Flex direction="column" gap="3" p="2">
          <Flex direction="column" gap="1">
            <Text size="2" weight="medium" color="gray">
              {t("settings.advanced.proxy.url", "Proxy URL")}
            </Text>
            <TextField.Root
              value={localProxyUrl}
              onChange={(e) => setLocalProxyUrl(e.target.value)}
              onBlur={() =>
                setProxySettings(localProxyUrl || null, proxyGlobalEnabled)
              }
              placeholder="http://127.0.0.1:7890"
              variant="surface"
              className="max-w-md"
            />
          </Flex>
          <Flex align="center" gap="2">
            <Switch
              size="1"
              checked={proxyGlobalEnabled}
              onCheckedChange={(checked: boolean) =>
                setProxySettings(settings?.proxy_url ?? null, checked)
              }
            />
            <Text size="2" color="gray">
              {t(
                "settings.advanced.proxy.globalEnabled",
                "Enable proxy globally",
              )}
            </Text>
          </Flex>
        </Flex>
      </SettingsGroup>

      {/* Transcription Optimization - Expert only */}
      {expertMode && (
        <SettingsGroup
          title={t("settings.advanced.groups.transcriptionOptimization")}
        >
          <TranslateToEnglish descriptionMode="inline" grouped={true} />
          <ModelUnloadTimeoutSetting descriptionMode="inline" grouped={true} />
        </SettingsGroup>
      )}

      {/* Data Management - Expert only */}
      {expertMode && (
        <SettingsGroup title={t("settings.advanced.groups.dataManagement")}>
          <HistoryLimit descriptionMode="inline" grouped={true} />
          <RecordingRetentionPeriodSelector
            descriptionMode="inline"
            grouped={true}
          />
        </SettingsGroup>
      )}

      {/* Debug Options - Expert only */}
      {expertMode && (
        <SettingsGroup title={t("settings.advanced.groups.debug")}>
          <LogDirectory descriptionMode="inline" grouped={true} />
          <LogLevelSelector descriptionMode="inline" grouped={true} />
          <WordCorrectionThreshold descriptionMode="inline" grouped={true} />
          <OfflineVadRealtimeInterval descriptionMode="inline" grouped={true} />
          <OfflineVadRealtimeWindow descriptionMode="inline" grouped={true} />
          <DebugLogChannels />
        </SettingsGroup>
      )}
    </Flex>
  );
};
