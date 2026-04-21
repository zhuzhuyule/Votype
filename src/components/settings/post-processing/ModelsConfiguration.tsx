import { Flex, SegmentedControl, Text } from "@radix-ui/themes";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useSettings } from "../../../hooks/useSettings";
import {
  DEFAULT_MODEL_LIST_VIEW_STATE,
  hasStoredModelListViewState,
  readModelListViewState,
  sanitizeProviderFilter,
  writeModelListViewState,
} from "../../../lib/modelListViewState";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { usePostProcessProviderState } from "../PostProcessingSettingsApi/usePostProcessProviderState";
import { ApiSettings } from "./ApiSettings";
import { AddModelDialog } from "./dialogs/AddModelDialog";
import { ModelListPanel } from "./ModelConfigurationPanel";

function getStoredModelListViewState() {
  if (typeof window === "undefined") {
    return DEFAULT_MODEL_LIST_VIEW_STATE;
  }

  return readModelListViewState(window.localStorage);
}

export const ModelsConfiguration: React.FC = () => {
  const { t } = useTranslation();

  const providerState = usePostProcessProviderState();
  const { settings } = useSettings();

  const [isModelPickerOpen, setIsModelPickerOpen] = useState(false);
  const lastSelectedProviderIdRef = useRef(providerState.selectedProviderId);

  // Provider filter: null = all, string = specific provider
  const [providerFilter, setProviderFilter] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      const storage = window.localStorage;
      if (hasStoredModelListViewState(storage)) {
        return readModelListViewState(storage).providerFilter;
      }
    }
    return providerState.selectedProviderId || null;
  });

  // Sync with provider sidebar clicks, but do not override the restored state
  // during the first render.
  useEffect(() => {
    const previousProviderId = lastSelectedProviderIdRef.current;
    const nextProviderId = providerState.selectedProviderId;

    if (nextProviderId && nextProviderId !== previousProviderId) {
      setProviderFilter(providerState.selectedProviderId);
    }

    lastSelectedProviderIdRef.current = nextProviderId;
  }, [providerState.selectedProviderId]);

  useEffect(() => {
    const providerIds = (settings?.post_process_providers ?? []).map(
      (provider) => provider.id,
    );
    const sanitizedState = sanitizeProviderFilter(
      {
        ...getStoredModelListViewState(),
        providerFilter,
      },
      providerIds,
    );

    if (sanitizedState.providerFilter !== providerFilter) {
      setProviderFilter(sanitizedState.providerFilter);
    }
  }, [providerFilter, settings?.post_process_providers]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    writeModelListViewState(window.localStorage, {
      ...getStoredModelListViewState(),
      providerFilter,
    });
  }, [providerFilter]);

  // Provider name map
  const providerNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    settings?.post_process_providers.forEach((p) => {
      map[p.id] = p.label;
    });
    return map;
  }, [settings?.post_process_providers]);

  // The Provider toggle button always reflects the provider selected in the
  // upper Provider picker. Falls back to the current providerFilter so users
  // who restored a filter from localStorage without a matching sidebar pick
  // still see a meaningful toggle.
  const providerButtonId =
    providerState.selectedProviderId || providerFilter || null;
  const providerButtonLabel = providerButtonId
    ? (providerNameMap[providerButtonId] ?? providerButtonId)
    : null;
  const isProviderButtonActive =
    !!providerButtonId && providerFilter === providerButtonId;
  const providerButtonCount = providerButtonId
    ? (settings?.cached_models ?? []).filter(
        (m) => m.provider_id === providerButtonId,
      ).length
    : 0;

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

            {/* Scope toggle — "All" vs the provider selected in the upper
                picker. Stays as a two-option segmented control so switching
                back and forth is one click; label and count of the provider
                side update live when the upper picker changes. */}
            <SegmentedControl.Root
              size="1"
              value={isProviderButtonActive ? "provider" : "all"}
              onValueChange={(v) =>
                setProviderFilter(v === "provider" ? providerButtonId : null)
              }
              className="ml-1"
            >
              <SegmentedControl.Item value="all">
                <Flex align="center" gap="1">
                  {t("settings.postProcessing.models.filter.all", "All")}
                  <Text size="1" className="tabular-nums opacity-70">
                    {settings?.cached_models?.length ?? 0}
                  </Text>
                </Flex>
              </SegmentedControl.Item>
              {providerButtonId && providerButtonLabel && (
                <SegmentedControl.Item value="provider">
                  <Flex align="center" gap="1">
                    {providerButtonLabel}
                    <Text size="1" className="tabular-nums opacity-70">
                      {providerButtonCount}
                    </Text>
                  </Flex>
                </SegmentedControl.Item>
              )}
            </SegmentedControl.Root>
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
