import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { useSettings } from "../../hooks/useSettings";
import { ModelUnloadTimeout } from "../../lib/types";
import { Dropdown } from "../ui/Dropdown";
import { SettingContainer } from "../ui/SettingContainer";
import { ActionWrapper } from "../ui/ActionWrapper";

interface ModelUnloadTimeoutProps {
  descriptionMode?: "tooltip" | "inline";
  grouped?: boolean;
}

const getTimeoutOptions = (t: any) => [
  {
    value: "never" as ModelUnloadTimeout,
    label: t("settings.advanced.modelUnload.options.never"),
  },
  {
    value: "immediately" as ModelUnloadTimeout,
    label: t("settings.advanced.modelUnload.options.immediately"),
  },
  {
    value: "min2" as ModelUnloadTimeout,
    label: t("settings.advanced.modelUnload.options.min2"),
  },
  {
    value: "min5" as ModelUnloadTimeout,
    label: t("settings.advanced.modelUnload.options.min5"),
  },
  {
    value: "min10" as ModelUnloadTimeout,
    label: t("settings.advanced.modelUnload.options.min10"),
  },
  {
    value: "min15" as ModelUnloadTimeout,
    label: t("settings.advanced.modelUnload.options.min15"),
  },
  {
    value: "hour1" as ModelUnloadTimeout,
    label: t("settings.advanced.modelUnload.options.hour1"),
  },
];

const getDebugTimeoutOptions = (t: any) => [
  ...getTimeoutOptions(t),
  {
    value: "sec5" as ModelUnloadTimeout,
    label: t("settings.advanced.modelUnload.options.sec5"),
  },
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
      title={t("settings.advanced.modelUnload.title")}
      description={t("settings.advanced.modelUnload.description")}
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
