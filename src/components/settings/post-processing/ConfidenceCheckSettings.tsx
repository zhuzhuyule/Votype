// ConfidenceCheckSettings - Settings for LLM-based confidence checking
// Controls whether low-confidence transcriptions trigger a review dialog

import { Box } from "@radix-ui/themes";
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
          "Auto-Review Threshold",
        )}
        description={t(
          "settings.postProcessing.confidenceCheck.description",
          "Trigger review when text changes significantly after LLM processing",
        )}
        descriptionMode="inline"
        grouped={true}
      />
      {!enabled && (
        <div className="mt-1 px-1 text-[11px] text-[var(--gray-9)] italic opacity-80">
          {t(
            "settings.postProcessing.confidenceCheck.insertStabilityHint",
            "If insertion is unstable, you can disable this feature temporarily.",
          )}
        </div>
      )}

      {/* Threshold Slider - only shown when enabled */}
      {enabled && (
        <Box mt="2">
          <Slider
            value={threshold}
            onChange={handleThresholdChange}
            min={5}
            max={100}
            step={5}
            label={t(
              "settings.postProcessing.confidenceCheck.threshold",
              "Change Threshold",
            )}
            description={t(
              "settings.postProcessing.confidenceCheck.thresholdHint",
              "Scores above this value will prompt for review",
            )}
            descriptionMode="inline"
            grouped={true}
            showValue={true}
            formatValue={(v) => `${Math.round(v)}%`}
          />
        </Box>
      )}
    </>
  );
};
