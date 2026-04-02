import { useCallback, useMemo, useState } from "react";
import { useSettings } from "../../../hooks/useSettings";
import type { PostProcessProvider } from "../../../lib/types";
import type { DropdownOption } from "../../ui/Dropdown";
import type { ModelOption } from "./types";

export type PostProcessProviderState = {
  enabled: boolean;
  providers: PostProcessProvider[];
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
  handleProviderSelect: (providerId: string) => Promise<void>;
  handleModelSelect: (value: string) => void;
  handleModelCreate: (value: string) => void;
  handleRefreshModels: () => void;
  testConnection: () => Promise<string | null>;
  testInference: (
    modelId: string,
  ) => Promise<{ result?: string; error?: string; hasThinking?: boolean }>;
  verifiedProviderIds: Set<string>;
  activeProviderId: string;
  activateProvider: (providerId: string) => Promise<void>;
  lastInferenceResult: {
    result?: string;
    hasThinking?: boolean;
    error?: string;
  } | null;
  setLastInferenceResult: (
    result: { result?: string; hasThinking?: boolean; error?: string } | null,
  ) => void;
};

const APPLE_PROVIDER_ID = "apple_intelligence";

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
    testPostProcessInference,
  } = useSettings();

  const enabled = settings?.post_process_enabled || false;

  // Settings are guaranteed to have providers after migration
  const providers = settings?.post_process_providers || [];

  // Determine the active provider from settings, ensuring it exists
  const activeProviderId = useMemo(() => {
    const savedId = settings?.post_process_provider_id;
    // Verify the saved provider still exists in the list
    if (savedId && providers.some((p) => p.id === savedId)) {
      return savedId;
    }
    return providers[0]?.id || "openai";
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
    async (providerId: string) => {
      setViewingProviderId(providerId);
    },
    [],
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
    if (isAppleProvider) return;
    fetchPostProcessModels(viewingProviderId).catch((error) => {
      console.error("Failed to fetch models:", error);
    });
  }, [fetchPostProcessModels, isAppleProvider, viewingProviderId]);

  const [verifiedProviderIds, setVerifiedProviderIds] = useState<Set<string>>(
    new Set(),
  );

  const testConnection = useCallback(async (): Promise<string | null> => {
    if (isAppleProvider) return null;
    try {
      await fetchPostProcessModels(viewingProviderId);
      setVerifiedProviderIds((prev) => {
        const next = new Set(prev);
        next.add(viewingProviderId);
        return next;
      });
      return null;
    } catch (error) {
      setVerifiedProviderIds((prev) => {
        const next = new Set(prev);
        next.delete(viewingProviderId);
        return next;
      });
      return typeof error === "string" ? error : JSON.stringify(error);
    }
  }, [fetchPostProcessModels, isAppleProvider, viewingProviderId]);

  const testInference = useCallback(
    async (
      modelId: string,
    ): Promise<{ result?: string; error?: string; hasThinking?: boolean }> => {
      try {
        const { content, reasoning_content } = await testPostProcessInference(
          viewingProviderId,
          modelId,
        );

        const hasThinking =
          !!reasoning_content ||
          (!!content &&
            (content.includes("<think>") || content.includes("</think>")));

        const finalResult = content || "No response content";

        return {
          result: finalResult,
          hasThinking,
        };
      } catch (error) {
        return {
          error: typeof error === "string" ? error : JSON.stringify(error),
        };
      }
    },
    [testPostProcessInference, viewingProviderId],
  );

  const [lastInferenceResult, setLastInferenceResult] = useState<{
    result?: string;
    hasThinking?: boolean;
    error?: string;
  } | null>(null);

  const availableModelsRaw = postProcessModelOptions[viewingProviderId] || [];
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
    providers,
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
    testInference,
    verifiedProviderIds,
    activateProvider: setPostProcessProvider,
    lastInferenceResult,
    setLastInferenceResult,
  };
};
