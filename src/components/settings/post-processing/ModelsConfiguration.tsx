import { Box, Button, Flex, Text } from "@radix-ui/themes";
import { IconList } from "@tabler/icons-react";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { useSettings } from "../../../hooks/useSettings";
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

  // Provider filter: null = all, string = specific provider
  const [providerFilter, setProviderFilter] = useState<string | null>(
    providerState.selectedProviderId || null,
  );

  // Sync with provider sidebar clicks
  useEffect(() => {
    if (providerState.selectedProviderId) {
      setProviderFilter(providerState.selectedProviderId);
    }
  }, [providerState.selectedProviderId]);

  // Provider name map
  const providerNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    settings?.post_process_providers.forEach((p) => {
      map[p.id] = p.label;
    });
    return map;
  }, [settings?.post_process_providers]);

  // Count models for current provider filter
  const filteredCount = useMemo(() => {
    if (!providerFilter) return settings?.cached_models?.length ?? 0;
    return (settings?.cached_models ?? []).filter(
      (m) => m.provider_id === providerFilter,
    ).length;
  }, [settings?.cached_models, providerFilter]);

  const isShowingAll = providerFilter === null;
  const activeProviderLabel = providerFilter
    ? (providerNameMap[providerFilter] ?? providerFilter)
    : null;

  return (
    <Flex direction="column" gap="6" className="max-w-5xl w-full mx-auto">
      {/* 1. API Configuration */}
      <ApiSettings
        isFetchingModels={providerState.isFetchingModels}
        providerState={providerState}
        onOpenAddModel={() => setIsModelPickerOpen(true)}
      />

      {/* 2. Models Panel */}
      <SettingsGroup
        title={
          <Flex align="center" gap="2">
            <span>{t("settings.postProcessing.models.title")}</span>

            {/* "All" button */}
            <Button
              size="1"
              variant={isShowingAll ? "solid" : "soft"}
              color={isShowingAll ? "indigo" : "gray"}
              onClick={() => setProviderFilter(null)}
              className="ml-1"
            >
              <IconList size={13} />
              {t("settings.postProcessing.models.filter.all", "All")}
            </Button>

            {/* Provider indicator when filtered */}
            {activeProviderLabel && (
              <>
                <Text size="2" className="text-(--gray-7)">
                  /
                </Text>
                <Flex align="center" gap="1.5">
                  <Box className="w-1.5 h-1.5 rounded-full bg-(--accent-9)" />
                  <Text size="2" weight="medium" className="text-(--accent-11)">
                    {activeProviderLabel}
                  </Text>
                  <Text size="1" className="text-(--gray-8) tabular-nums">
                    {filteredCount}
                  </Text>
                </Flex>
              </>
            )}
          </Flex>
        }
      >
        <ModelListPanel
          targetType={["text", "asr", "other"]}
          providerFilter={providerFilter}
          onProviderFilterChange={setProviderFilter}
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
