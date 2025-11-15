import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { useSettings } from "../../hooks/useSettings";
import { ModelUnloadTimeout } from "../../lib/types";
import { Dropdown } from "../ui/Dropdown";
import { SettingContainer } from "../ui/SettingContainer";
import { ActionWrapper } from "../ui/ActionWraperr";

interface ModelUnloadTimeoutProps {
  descriptionMode?: "tooltip" | "inline";
  grouped?: boolean;
}

const getTimeoutOptions = (t: any) => [
  { value: "never" as ModelUnloadTimeout, label: t("modelUnloadTimeout.never") },
  { value: "immediately" as ModelUnloadTimeout, label: t("modelUnloadTimeout.immediately") },
  { value: "min2" as ModelUnloadTimeout, label: t("modelUnloadTimeout.min2") },
  { value: "min5" as ModelUnloadTimeout, label: t("modelUnloadTimeout.min5") },
  { value: "min10" as ModelUnloadTimeout, label: t("modelUnloadTimeout.min10") },
  { value: "min15" as ModelUnloadTimeout, label: t("modelUnloadTimeout.min15") },
  { value: "hour1" as ModelUnloadTimeout, label: t("modelUnloadTimeout.hour1") },
];

const getDebugTimeoutOptions = (t: any) => [
  ...getTimeoutOptions(t),
  { value: "sec5" as ModelUnloadTimeout, label: t("modelUnloadTimeout.sec5Debug") },
];

export const ModelUnloadTimeoutSetting: React.FC<ModelUnloadTimeoutProps> = ({
  descriptionMode = "inline",
  grouped = false,
}) => {
  const { t } = useTranslation();
  const { settings, getSetting, updateSetting } = useSettings();

  const handleChange = async (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newTimeout = event.target.value as ModelUnloadTimeout;

    try {
      await invoke("set_model_unload_timeout", { timeout: newTimeout });
      updateSetting("model_unload_timeout", newTimeout);
    } catch (error) {
      console.error("Failed to update model unload timeout:", error);
    }
  };

  const currentValue = getSetting("model_unload_timeout") ?? "never";

  const options = useMemo(() => {
    return settings?.debug_mode === true ? getDebugTimeoutOptions(t) : getTimeoutOptions(t);
  }, [settings, t]);

  return (
    <SettingContainer
      title={t("modelUnloadTimeout.title")}
      description={t("modelUnloadTimeout.description")}
      descriptionMode={descriptionMode}
      grouped={grouped}
    >
      <ActionWrapper>
        <Dropdown
          options={options}
          selectedValue={currentValue}
          onSelect={(value) =>
            handleChange({
              target: { value },
            } as React.ChangeEvent<HTMLSelectElement>)
          }
          disabled={false}
        />
      </ActionWrapper>
    </SettingContainer>
  );
};
