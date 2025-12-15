import React from "react";
import { useTranslation } from "react-i18next";
import { useModels } from "../../../hooks/useModels";
import { useSettings } from "../../../hooks/useSettings";
import { ToggleSwitch } from "../../ui/ToggleSwitch";
import { SettingContainer } from "../../ui/SettingContainer";
import { SecondaryModelDropdown } from "./SecondaryModelDropdown";

interface SecondaryTranscriptFusionProps {
  grouped?: boolean;
}

export const SecondaryTranscriptFusion: React.FC<
  SecondaryTranscriptFusionProps
> = React.memo(({ grouped = false }) => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating } = useSettings();
  const { models } = useModels();

  const postProcessEnabled = getSetting("post_process_enabled") || false;
  const fusionEnabled = getSetting("post_process_use_secondary_output") || false;
  const onlineAsrEnabled = getSetting("online_asr_enabled") || false;
  const secondaryModelId = getSetting("post_process_secondary_model_id");

  const canSelectSecondaryModel = postProcessEnabled && fusionEnabled && onlineAsrEnabled;

  return (
    <>
      <ToggleSwitch
        checked={fusionEnabled}
        onChange={(enabled) =>
          updateSetting("post_process_use_secondary_output", enabled)
        }
        isUpdating={isUpdating("post_process_use_secondary_output")}
        disabled={!postProcessEnabled}
        label={t("settings.postProcessing.fusion.enabled.label")}
        description={t("settings.postProcessing.fusion.enabled.description")}
        descriptionMode={"tooltip"}
        tooltipPosition="top"
        grouped={grouped}
      />

      {onlineAsrEnabled ? (
        <SettingContainer
          title={t("settings.postProcessing.fusion.secondaryModel.title")}
          description={t("settings.postProcessing.fusion.secondaryModel.description")}
          grouped={grouped}
          disabled={!canSelectSecondaryModel}
        >
          <div className="min-w-[16rem] max-w-[28rem]">
            <SecondaryModelDropdown
              disabled={!canSelectSecondaryModel}
              models={models}
              selectedModelId={secondaryModelId}
              onSelect={(value) =>
                updateSetting("post_process_secondary_model_id", value)
              }
            />
          </div>
        </SettingContainer>
      ) : null}
    </>
  );
});
