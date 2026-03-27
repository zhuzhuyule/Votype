import { Flex, Grid } from "@radix-ui/themes";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import { useSettings } from "../../../hooks/useSettings";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { usePostProcessProviderState } from "../PostProcessingSettingsApi/usePostProcessProviderState";
import { ApiSettings } from "./ApiSettings";
import { AddModelDialog } from "./dialogs/AddModelDialog";
import { TextModelModeSettings } from "./LengthRoutingSettings";
import { ModelListPanel } from "./ModelConfigurationPanel";

export const ModelsConfiguration: React.FC = () => {
  const { t } = useTranslation();

  const providerState = usePostProcessProviderState();
  const { settings } = useSettings();

  const [isModelPickerOpen, setIsModelPickerOpen] = useState(false);

  return (
    <Flex direction="column" gap="6" className="max-w-5xl w-full mx-auto">
      {/* 1. API Configuration */}
      <ApiSettings
        onAddModel={() => setIsModelPickerOpen(true)}
        isFetchingModels={providerState.isFetchingModels}
        providerState={providerState}
      />

      {/* 2. Default Model / Length Routing (expert mode) */}
      {settings?.expert_mode && <TextModelModeSettings />}

      {/* 3. Models Grid (Side-by-Side) */}
      <Grid columns="2" gap="4">
        {/* Text Models */}
        <SettingsGroup
          title={t("settings.postProcessing.models.modelTypes.text.label")}
        >
          <ModelListPanel
            targetType="text"
            allowSelection={!settings?.expert_mode}
          />
        </SettingsGroup>

        {/* ASR Models */}
        <SettingsGroup
          title={t("settings.postProcessing.models.modelTypes.asr.label")}
        >
          <ModelListPanel targetType={["asr", "other"]} />
        </SettingsGroup>
      </Grid>

      <AddModelDialog
        open={isModelPickerOpen}
        onOpenChange={setIsModelPickerOpen}
        providerState={providerState}
        isFetchingModels={providerState.isFetchingModels}
      />
    </Flex>
  );
};
