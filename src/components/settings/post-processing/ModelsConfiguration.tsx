
import {
    Button,
    Dialog,
    Flex,
    IconButton,
    Text,
    TextField
} from "@radix-ui/themes";
import { Eye, EyeOff } from "lucide-react";
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

  return (
    <Flex direction="column" gap="4">
      <SettingContainer
        title={t("postProcessing.title")}
        description={t("postProcessing.description")}
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
        title={t("postProcessing.baseUrlTitle")}
        description={t("postProcessing.baseUrlDescription")}
        descriptionMode="tooltip"
        layout="horizontal"
        grouped={true}
      >
        <ActionWrapper className="w-100">
          <TextField.Root
            value={state.baseUrl}
            onBlur={(e) => state.handleBaseUrlChange(e.target.value)}
            placeholder="https://api.openai.com/v1"
            disabled={
              !state.selectedProvider?.allow_base_url_edit ||
              state.isBaseUrlUpdating
            }
          />
        </ActionWrapper>
      </SettingContainer>

      <SettingContainer
        title={t("postProcessing.apiKeyTitle")}
        description={t("postProcessing.apiKeyDescription")}
        descriptionMode="tooltip"
        layout="horizontal"
        grouped={true}
      >
        <ActionWrapper className="w-140">
          <TextField.Root
            value={state.apiKey}
            onBlur={(e) => state.handleApiKeyChange(e.target.value)}
            placeholder="sk-..."
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
                  <EyeOff height={14} width={14} />
                ) : (
                  <Eye height={14} width={14} />
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
        title={t("postProcessing.apiTitle")}
        actions={
          <Button
            variant="outline"
            size="1"
            onClick={() => setProviderManagerOpen(true)}
          >
            {t("postProcessing.manageProviders")}
          </Button>
        }
      >
        <ApiSettings />
        <Flex justify="end">
          <Text size="1" color="gray" style={{ opacity: 0.7 }}>
            {t("common.autoSaved")}
          </Text>
        </Flex>
      </SettingsGroup>

      <SettingsGroup title={t("postProcessing.modelSelection")}>
        <ModelConfigurationPanel />
      </SettingsGroup>

      {/* Provider Manager Dialog */}
      <Dialog.Root
        open={isProviderManagerOpen}
        onOpenChange={setProviderManagerOpen}
      >
        <Dialog.Content maxWidth="900px" style={{ maxHeight: "80vh" }}>
          <Dialog.Title>{t("postProcessing.manageProviders")}</Dialog.Title>
          <div style={{ maxHeight: "70vh", overflowY: "auto" }}>
            <ProviderManager onClose={() => setProviderManagerOpen(false)} />
          </div>
        </Dialog.Content>
      </Dialog.Root>
    </Flex>
  );
};
