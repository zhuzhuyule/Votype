import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Flex, Button, Text } from "@radix-ui/themes";
import { ToggleSwitch } from "../ui/ToggleSwitch";
import { SettingContainer } from "../ui/SettingContainer";
import { Dropdown } from "../ui/Dropdown";
import { ActionWrapper } from "../ui/ActionWrapper";
import { useSettings } from "../../hooks/useSettings";
import { useModels } from "../../hooks/useModels";
import { getTranslatedModelName } from "../../lib/utils/modelTranslation";

interface PunctuationSettingsProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const PunctuationSettings: React.FC<PunctuationSettingsProps> = ({
  descriptionMode = "tooltip",
  grouped = false,
}) => {
  const { t } = useTranslation();
  const { settings, getSetting, updateSetting, isUpdating } = useSettings();
  const { models, downloadModel, isModelDownloading, isModelExtracting } =
    useModels();

  const enabled = getSetting("punctuation_enabled") || false;
  const selectedModelId =
    getSetting("punctuation_model") ||
    "punct-zh-en-ct-transformer-2024-04-12-int8";

  const punctuationModels = useMemo(() => {
    return models
      .filter((m) => m.id.startsWith("punct-"))
      .sort((a, b) => a.size_mb - b.size_mb);
  }, [models]);

  const selectedModel = punctuationModels.find((m) => m.id === selectedModelId);
  const selectedModelName = selectedModel
    ? getTranslatedModelName(selectedModel as any, t)
    : selectedModelId;

  const options = useMemo(() => {
    if (punctuationModels.length === 0) return [];
    return punctuationModels.map((m) => ({
      value: m.id,
      label: `${getTranslatedModelName(m as any, t)} · ${m.size_mb}MB`,
    }));
  }, [punctuationModels, t]);

  const needsDownload = enabled && selectedModel && !selectedModel.is_downloaded;
  const isBusy =
    !!(selectedModel && (isModelDownloading(selectedModel.id) || isModelExtracting(selectedModel.id)));
  const busyLabel = selectedModel
    ? isModelExtracting(selectedModel.id)
      ? t("modelSelector.extractingGeneric")
      : t("modelSelector.downloading", { percentage: 0 })
    : t("modelSelector.downloading", { percentage: 0 });

  return (
    <>
      <ToggleSwitch
        checked={enabled}
        onChange={(checked) => updateSetting("punctuation_enabled", checked)}
        isUpdating={isUpdating("punctuation_enabled")}
        label={t("settings.advanced.punctuation.label")}
        description={t("settings.advanced.punctuation.description", {
          model: selectedModelName,
        })}
        descriptionMode={descriptionMode}
        grouped={grouped}
      />

      {enabled ? (
        <SettingContainer
          title={t("settings.advanced.punctuation.model.title")}
          description={t("settings.advanced.punctuation.model.description")}
          descriptionMode={descriptionMode}
          grouped={grouped}
        >
          <ActionWrapper>
            <Flex direction="column" gap="2" className="w-full">
              <Dropdown
                options={options}
                selectedValue={selectedModelId}
                onSelect={(value) => updateSetting("punctuation_model", value)}
                disabled={options.length === 0 || isUpdating("punctuation_model")}
              />
              {needsDownload ? (
                <Flex align="center" justify="between" gap="2">
                  <Text size="1" color="gray">
                    {t("settings.advanced.punctuation.model.notDownloaded")}
                  </Text>
                  <Button
                    size="1"
                    disabled={isBusy}
                    onClick={() => downloadModel(selectedModel.id)}
                  >
                    {isBusy ? busyLabel : t("modelSelector.download")}
                  </Button>
                </Flex>
              ) : null}
            </Flex>
          </ActionWrapper>
        </SettingContainer>
      ) : null}
    </>
  );
};
