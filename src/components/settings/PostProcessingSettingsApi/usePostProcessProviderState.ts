import { useCallback, useMemo, useState } from "react";
import { useSettings } from "../../../hooks/useSettings";
import type { PostProcessProvider } from "../../../lib/types";
import type { DropdownOption } from "../../ui/Dropdown";
import type { ModelOption } from "./types";

export type PostProcessProviderState = {
  enabled: boolean;
  providerOptions: DropdownOption[];
  selectedProviderId: string;
  selectedProvider: PostProcessProvider | undefined;
  isCustomProvider: boolean;
  isAppleProvider: boolean;
  baseUrl: string;
  handleBaseUrlChange: (value: string) => Promise<void>;
  isBaseUrlUpdating: boolean;
  apiKey: string;
  apiKeys: Record<string, string>;
  handleApiKeyChange: (value: string) => Promise<void>;
  isApiKeyUpdating: boolean;
  modelsEndpoint: string;
  handleModelsEndpointChange: (value: string) => void;
  model: string;
  handleModelChange: (value: string) => void;
  modelOptions: ModelOption[];
  isModelUpdating: boolean;
  isFetchingModels: boolean;
  handleProviderSelect: (providerId: string) => void;
  handleModelSelect: (value: string) => void;
  handleModelCreate: (value: string) => void;
  handleRefreshModels: () => void;
  testConnection: () => Promise<boolean>;
  verifiedProviderIds: Set<string>;
  activeProviderId: string;
  activateProvider: (providerId: string) => Promise<void>;
};

const APPLE_PROVIDER_ID = "apple_intelligence";

const BUILTIN_PROVIDER_IDS = [
  "openai",
  "anthropic",
  "apple_intelligence",
  "iflow",
  "gitee",
];

export const usePostProcessProviderState = (): PostProcessProviderState => {
  const {
    settings,
    isUpdating,
    setPostProcessProvider,
    updatePostProcessBaseUrl,
    updatePostProcessApiKey,
    updatePostProcessModel,
    fetchPostProcessModels,
    postProcessModelOptions,
    updateCustomProvider,
    removeCustomProvider,
  } = useSettings();

  const enabled = settings?.post_process_enabled || false;

  // Settings are guaranteed to have providers after migration
  const providers = settings?.post_process_providers || [];

  // Determine the active provider from settings
  const activeProviderId = useMemo(() => {
    return settings?.post_process_provider_id || providers[0]?.id || "openai";
  }, [providers, settings?.post_process_provider_id]);

  // Local state for which provider is currently being viewed/edited
  const [viewingProviderId, setViewingProviderId] =
    useState<string>(activeProviderId);

  // Sync viewing provider with active provider ONLY when settings first load
  // or if viewingProviderId is invalid
  const isValidViewingId = providers.some((p) => p.id === viewingProviderId);
  if (!isValidViewingId && providers.length > 0) {
    setViewingProviderId(activeProviderId);
  }

  const selectedProvider = useMemo(() => {
    return (
      providers.find((provider) => provider.id === viewingProviderId) ||
      providers[0]
    );
  }, [providers, viewingProviderId]);

  const isAppleProvider = selectedProvider?.id === APPLE_PROVIDER_ID;

  // Use settings directly as single source of truth
  const baseUrl = selectedProvider?.base_url ?? "";
  const apiKey = settings?.post_process_api_keys?.[viewingProviderId] ?? "";
  const model = settings?.post_process_models?.[viewingProviderId] ?? "";
  const modelsEndpoint = selectedProvider?.models_endpoint ?? "";

  const providerOptions = useMemo<DropdownOption[]>(() => {
    return providers.map((provider) => ({
      value: provider.id,
      label: provider.label,
    }));
  }, [providers]);

  const handleProviderSelect = useCallback(
    (providerId: string) => {
      console.log("[DEBUG] handleProviderSelect called", {
        providerId,
        previousId: viewingProviderId,
      });

      setViewingProviderId(providerId);
    },
    [viewingProviderId, settings?.post_process_api_keys, removeCustomProvider],
  );

  const handleBaseUrlChange = useCallback(
    async (value: string) => {
      if (!selectedProvider) {
        return;
      }
      const trimmed = value.trim();
      if (trimmed && trimmed !== baseUrl) {
        await updatePostProcessBaseUrl(selectedProvider.id, trimmed);
      }
    },
    [selectedProvider, baseUrl, updatePostProcessBaseUrl],
  );

  const handleApiKeyChange = useCallback(
    async (value: string) => {
      const trimmed = value.trim();
      if (trimmed !== apiKey) {
        await updatePostProcessApiKey(viewingProviderId, trimmed);
      }
    },
    [apiKey, viewingProviderId, updatePostProcessApiKey],
  );

  const handleModelsEndpointChange = useCallback(
    (value: string) => {
      if (!viewingProviderId) return;
      const trimmed = value.trim();
      if (trimmed !== modelsEndpoint) {
        void updateCustomProvider({
          providerId: viewingProviderId,
          modelsEndpoint: trimmed,
        });
      }
    },
    [viewingProviderId, modelsEndpoint, updateCustomProvider],
  );

  const handleModelChange = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (trimmed !== model) {
        void updatePostProcessModel(viewingProviderId, trimmed);
      }
    },
    [model, viewingProviderId, updatePostProcessModel],
  );

  const handleModelSelect = useCallback(
    (value: string) => {
      void updatePostProcessModel(viewingProviderId, value.trim());
    },
    [viewingProviderId, updatePostProcessModel],
  );

  const handleModelCreate = useCallback(
    (value: string) => {
      void updatePostProcessModel(viewingProviderId, value);
    },
    [viewingProviderId, updatePostProcessModel],
  );

  const handleRefreshModels = useCallback(() => {
    console.log("[DEBUG] handleRefreshModels called", {
      viewingProviderId,
      isAppleProvider,
    });
    if (isAppleProvider) return;
    fetchPostProcessModels(viewingProviderId)
      .then((models) => {
        console.log("[DEBUG] fetchPostProcessModels success", {
          viewingProviderId,
          models,
        });
      })
      .catch((error) => {
        console.error("[DEBUG] fetchPostProcessModels failed", {
          viewingProviderId,
          error,
        });
      });
  }, [fetchPostProcessModels, isAppleProvider, viewingProviderId]);

  const [verifiedProviderIds, setVerifiedProviderIds] = useState<Set<string>>(
    new Set(),
  );

  const testConnection = useCallback(async () => {
    if (isAppleProvider) return true;
    try {
      await fetchPostProcessModels(viewingProviderId);
      setVerifiedProviderIds((prev) => {
        const next = new Set(prev);
        next.add(viewingProviderId);
        return next;
      });
      return true;
    } catch (error) {
      setVerifiedProviderIds((prev) => {
        const next = new Set(prev);
        next.delete(viewingProviderId);
        return next;
      });
      return false;
    }
  }, [fetchPostProcessModels, isAppleProvider, viewingProviderId]);

  const availableModelsRaw = postProcessModelOptions[viewingProviderId] || [];
  console.log("[DEBUG] modelOptions computed", {
    viewingProviderId,
    availableModelsRaw,
    allOptions: postProcessModelOptions,
  });

  const modelOptions = useMemo<ModelOption[]>(() => {
    const seen = new Set<string>();
    const options: ModelOption[] = [];

    const upsert = (value: string | null | undefined) => {
      const trimmed = value?.trim();
      if (!trimmed || seen.has(trimmed)) return;
      seen.add(trimmed);
      options.push({ value: trimmed, label: trimmed });
    };

    // Add available models from API
    for (const candidate of availableModelsRaw) {
      upsert(candidate);
    }

    // Ensure current model is in the list
    upsert(model);

    return options;
  }, [availableModelsRaw, model]);

  const isBaseUrlUpdating = isUpdating(
    `post_process_base_url:${viewingProviderId}`,
  );
  const isApiKeyUpdating = isUpdating(
    `post_process_api_key:${viewingProviderId}`,
  );
  const isModelUpdating = isUpdating(`post_process_model:${viewingProviderId}`);
  const isFetchingModels = isUpdating(
    `post_process_models_fetch:${viewingProviderId}`,
  );

  const isCustomProvider = selectedProvider?.id === "custom";

  // No automatic fetching - user must click refresh button

  // All API keys for checking empty providers
  const apiKeys = settings?.post_process_api_keys ?? {};

  return {
    enabled,
    providerOptions,
    selectedProviderId: viewingProviderId, // Keep for compatibility or rename
    activeProviderId,
    selectedProvider,
    isCustomProvider,
    isAppleProvider,
    baseUrl,
    handleBaseUrlChange,
    isBaseUrlUpdating,
    apiKey,
    apiKeys,
    handleApiKeyChange,
    isApiKeyUpdating,
    model,
    handleModelChange,
    modelOptions,
    isModelUpdating,
    isFetchingModels,
    handleProviderSelect,
    handleModelSelect,
    handleModelCreate,
    handleRefreshModels,
    modelsEndpoint,
    handleModelsEndpointChange,
    testConnection,
    verifiedProviderIds,
    activateProvider: setPostProcessProvider,
  };
};
