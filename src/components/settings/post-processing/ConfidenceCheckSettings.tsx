// ConfidenceCheckSettings - Settings for LLM-based confidence checking
// Controls whether low-confidence transcriptions trigger a review dialog

import { invoke } from "@tauri-apps/api/core";
import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../../hooks/useSettings";
import { Slider } from "../../ui/Slider";
import { ToggleSwitch } from "../../ui/ToggleSwitch";

export const ConfidenceCheckSettings: React.FC = () => {
  const { t } = useTranslation();
  const { settings, updateSetting } = useSettings();

  const enabled = settings?.confidence_check_enabled ?? false;
  const threshold = settings?.confidence_threshold ?? 70;

  const handleToggle = useCallback(
    async (checked: boolean) => {
      await invoke("change_confidence_check_setting", { enabled: checked });
      updateSetting("confidence_check_enabled", checked);
    },
    [updateSetting],
  );

  const handleThresholdChange = useCallback(
    async (value: number) => {
      const newThreshold = Math.round(value);
      await invoke("change_confidence_threshold_setting", {
        threshold: newThreshold,
      });
      updateSetting("confidence_threshold", newThreshold);
    },
    [updateSetting],
  );

  return (
    <>
      <ToggleSwitch
        checked={enabled}
        onChange={handleToggle}
        label={t(
          "settings.postProcessing.confidenceCheck.title",
          "Confidence Check",
        )}
        description={t(
          "settings.postProcessing.confidenceCheck.description",
          "Review transcriptions when LLM reports low confidence",
        )}
        grouped={true}
      />
      <div className="mt-2 text-xs text-gray-500">
        {t(
          "settings.postProcessing.confidenceCheck.insertStabilityHint",
          "If insertion is unstable, you can disable this feature temporarily.",
        )}
      </div>

      {/* Threshold Slider - only shown when enabled */}
      {enabled && (
        <Slider
          value={threshold}
          onChange={handleThresholdChange}
          min={50}
          max={100}
          step={5}
          label={t(
            "settings.postProcessing.confidenceCheck.threshold",
            "Confidence Threshold",
          )}
          description={t(
            "settings.postProcessing.confidenceCheck.thresholdHint",
            "Scores below this value will prompt for review",
          )}
          grouped={true}
          showValue={true}
          formatValue={(v) => `${Math.round(v)}%`}
        />
      )}
    </>
  );
};
