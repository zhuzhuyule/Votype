import { Flex, SegmentedControl } from "@radix-ui/themes";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import { useSettings } from "../../../hooks/useSettings";
import type { ModelType } from "../../../lib/types";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { usePostProcessProviderState } from "../PostProcessingSettingsApi/usePostProcessProviderState";
import { ApiSettings } from "./ApiSettings";
import { AddModelDialog } from "./dialogs/AddModelDialog";
import { ModelListPanel } from "./ModelConfigurationPanel";

export const ModelsConfiguration: React.FC = () => {
  const { t } = useTranslation();

  const providerState = usePostProcessProviderState();
  const { settings } = useSettings();

  const [isModelPickerOpen, setIsModelPickerOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState<ModelType>("text");

  return (
    <Flex direction="column" gap="6" className="max-w-5xl w-full mx-auto">
      {/* 1. API Configuration */}
      <ApiSettings
        isFetchingModels={providerState.isFetchingModels}
        providerState={providerState}
        onOpenAddModel={() => setIsModelPickerOpen(true)}
      />

      {/* 2. Unified Models Panel */}
      <SettingsGroup
        title={
          <Flex align="center" gap="3">
            <span>{t("settings.postProcessing.models.title")}</span>
            <SegmentedControl.Root
              value={activeFilter}
              onValueChange={(v) => setActiveFilter(v as ModelType)}
              size="2"
            >
              <SegmentedControl.Item value="text" className="mx-10">
                {t("settings.postProcessing.models.modelTypes.text.label")}
              </SegmentedControl.Item>
              <SegmentedControl.Item value="asr">
                {t("settings.postProcessing.models.modelTypes.asr.label")}
              </SegmentedControl.Item>
            </SegmentedControl.Root>
          </Flex>
        }
      >
        <ModelListPanel
          targetType={["text", "asr", "other"]}
          allowSelection={false}
          activeFilter={activeFilter}
          preferredProviderId={providerState.selectedProviderId}
        />
      </SettingsGroup>

      <AddModelDialog
        open={isModelPickerOpen}
        onOpenChange={setIsModelPickerOpen}
        providerState={providerState}
        isFetchingModels={providerState.isFetchingModels}
      />
    </Flex>
  );
};
