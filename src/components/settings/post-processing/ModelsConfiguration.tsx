
import {
  Button,
  Dialog,
  Flex,
  IconButton,
  TextField
} from "@radix-ui/themes";
import { IconEye, IconEyeOff } from "@tabler/icons-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import { ActionWrapper } from "../../ui";
import { SettingContainer } from "../../ui/SettingContainer";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { ProviderSelect } from "../PostProcessingSettingsApi/ProviderSelect";
import { usePostProcessProviderState } from "../PostProcessingSettingsApi/usePostProcessProviderState";
import { ModelConfigurationPanel } from "./ModelConfigurationPanel";
import { ProviderManager } from "./ProviderManager";

const ApiSettings: React.FC = () => {
  const { t } = useTranslation();
  const state = usePostProcessProviderState();
  const [showApiKey, setShowApiKey] = useState(false);
  
  // Local state for input fields to allow real-time updates
  const [localBaseUrl, setLocalBaseUrl] = useState(state.baseUrl);
  const [localApiKey, setLocalApiKey] = useState(state.apiKey);

  // Sync local state when provider changes or settings update
  React.useEffect(() => {
    setLocalBaseUrl(state.baseUrl);
  }, [state.baseUrl]);

  React.useEffect(() => {
    setLocalApiKey(state.apiKey);
  }, [state.apiKey]);

  return (
    <Flex direction="column" gap="4">
      <SettingContainer
        title={t("settings.postProcessing.api.provider.title")}
        description={t("settings.postProcessing.api.provider.description")}
        descriptionMode="tooltip"
        layout="horizontal"
        grouped={true}
      >
        <ActionWrapper className="w-100">
          <ProviderSelect
            options={state.providerOptions}
            value={state.selectedProviderId}
            onChange={state.handleProviderSelect}
          />
        </ActionWrapper>
      </SettingContainer>

      <SettingContainer
        title={t("settings.postProcessing.api.baseUrl.title")}
        description={t("settings.postProcessing.api.baseUrl.description")}
        descriptionMode="tooltip"
        layout="horizontal"
        grouped={true}
      >
        <ActionWrapper className="w-100">
          <TextField.Root
            value={localBaseUrl}
            onChange={(e) => setLocalBaseUrl(e.target.value)}
            onBlur={(e) => state.handleBaseUrlChange(e.target.value)}
            placeholder={t("settings.postProcessing.api.baseUrl.placeholder")}
            disabled={
              !state.selectedProvider?.allow_base_url_edit ||
              state.isBaseUrlUpdating
            }
          />
        </ActionWrapper>
      </SettingContainer>

      <SettingContainer
        title={t("settings.postProcessing.api.apiKey.title")}
        description={t("settings.postProcessing.api.apiKey.description")}
        descriptionMode="tooltip"
        layout="horizontal"
        grouped={true}
      >
        <ActionWrapper className="w-140">
          <TextField.Root
            value={localApiKey}
            onChange={(e) => setLocalApiKey(e.target.value)}
            onBlur={(e) => state.handleApiKeyChange(e.target.value)}
            placeholder={t("settings.postProcessing.api.apiKey.placeholder")}
            type={showApiKey ? "text" : "password"}
            disabled={state.isApiKeyUpdating}
          >
            <TextField.Slot side="right">
              <IconButton
                size="1"
                variant="ghost"
                onClick={() => setShowApiKey(!showApiKey)}
                type="button"
              >
                {showApiKey ? (
                  <IconEyeOff height={14} width={14} />
                ) : (
                  <IconEye height={14} width={14} />
                )}
              </IconButton>
            </TextField.Slot>
          </TextField.Root>
        </ActionWrapper>
      </SettingContainer>
    </Flex>
  );
};

export const ModelsConfiguration: React.FC = () => {
  const { t } = useTranslation();
  const [isProviderManagerOpen, setProviderManagerOpen] = useState(false);

  return (
    <Flex direction="column" gap="6" className="max-w-3xl w-full mx-auto">
      <SettingsGroup
        title={t("settings.postProcessing.api.title")}
        actions={
          <Button
            variant="outline"
            size="1"
            onClick={() => setProviderManagerOpen(true)}
          >
            {t("settings.postProcessing.api.manageProviders")}
          </Button>
        }
      >
        <ApiSettings />
      </SettingsGroup>

      <SettingsGroup title={t("settings.postProcessing.models.title")}>
        <ModelConfigurationPanel />
      </SettingsGroup>

      {/* Provider Manager Dialog */}
      <Dialog.Root
        open={isProviderManagerOpen}
        onOpenChange={setProviderManagerOpen}
      >
        <Dialog.Content maxWidth="900px" style={{ maxHeight: "80vh" }}>
          <Dialog.Title>{t("settings.postProcessing.api.manageProviders")}</Dialog.Title>
          <div style={{ maxHeight: "70vh", overflowY: "auto" }}>
            <ProviderManager onClose={() => setProviderManagerOpen(false)} />
          </div>
        </Dialog.Content>
      </Dialog.Root>
    </Flex>
  );
};
