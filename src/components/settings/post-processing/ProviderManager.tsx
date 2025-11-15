import React, { useEffect, useMemo, useRef, useState } from "react";

import { Button, TextField } from "@radix-ui/themes";
import { useSettings } from "../../../hooks/useSettings";
import type { PostProcessProvider } from "../../../lib/types";

const DEFAULT_MODELS_ENDPOINT = "/models";

const isValidUrl = (value: string) => {
  const trimmed = value.trim().toLowerCase();
  return trimmed.startsWith("http://") || trimmed.startsWith("https://");
};

interface ProviderManagerProps {
  onClose: () => void;
}

export const ProviderManager: React.FC<ProviderManagerProps> = ({
  onClose,
}) => {
  const {
    settings,
    addCustomProvider,
    updateCustomProvider,
    removeCustomProvider,
    isUpdating,
  } = useSettings();

  const providers = settings?.post_process_providers || [];
  const [showAdd, setShowAdd] = useState(false);
  const [addDraft, setAddDraft] = useState({
    label: "",
    baseUrl: "",
    modelsEndpoint: DEFAULT_MODELS_ENDPOINT,
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({
    label: "",
    baseUrl: "",
    modelsEndpoint: DEFAULT_MODELS_ENDPOINT,
  });

  const handleStartEdit = (provider: PostProcessProvider) => {
    setEditingId(provider.id);
    setEditDraft({
      label: provider.label,
      baseUrl: provider.base_url,
      modelsEndpoint: provider.models_endpoint || DEFAULT_MODELS_ENDPOINT,
    });
  };

  const handleAdd = async () => {
    await addCustomProvider({
      label: addDraft.label,
      baseUrl: addDraft.baseUrl,
      modelsEndpoint: addDraft.modelsEndpoint,
    });
    setAddDraft({
      label: "",
      baseUrl: "",
      modelsEndpoint: DEFAULT_MODELS_ENDPOINT,
    });
    setShowAdd(false);
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    await updateCustomProvider({
      providerId: editingId,
      label: editDraft.label,
      baseUrl: editDraft.baseUrl,
      modelsEndpoint: editDraft.modelsEndpoint,
    });
    setEditingId(null);
  };

  const [showDeleteTooltip, setShowDeleteTooltip] = useState<string | null>(
    null,
  );
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Handle click outside to close tooltip
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        tooltipRef.current &&
        !tooltipRef.current.contains(event.target as Node)
      ) {
        setShowDeleteTooltip(null);
      }
    };

    if (showDeleteTooltip) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showDeleteTooltip]);

  const handleRemove = async (providerId: string) => {
    await removeCustomProvider(providerId);
    setShowDeleteTooltip(null);
  };

  const customProviders = useMemo(
    () => providers.filter((provider) => provider.allow_base_url_edit),
    [providers],
  );

  const builtInProviders = useMemo(
    () => providers.filter((provider) => !provider.allow_base_url_edit),
    [providers],
  );

  const canAdd =
    addDraft.label.trim() &&
    addDraft.baseUrl.trim() &&
    isValidUrl(addDraft.baseUrl);

  const canSaveEdit =
    editDraft.label.trim() &&
    editDraft.baseUrl.trim() &&
    isValidUrl(editDraft.baseUrl);

  const handleClose = () => {
    setShowAdd(false);
    setEditingId(null);
    onClose();
  };

  return (
    <div>
      <div className="fixed inset-0 z-40 bg-black/60" onClick={handleClose} />
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        onClick={handleClose}
      >
        <div
          className="w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-xl border border-mid-gray/20 bg-background p-8 shadow-2xl"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xl font-semibold text-text mb-2">
              Provider 管理
            </h2>
            <Button
              variant="ghost"
              onClick={handleClose}
              className="rounded-2xl -mt-5"
              style={{ fontSize: "1.5rem", lineHeight: 1 }}
            >
              ✕
            </Button>
          </div>
          <div className="space-y-4">
            {customProviders.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-mid-gray/90 uppercase tracking-wider">
                    自定义 Provider
                  </h3>
                  <Button
                    onClick={() => setShowAdd((prev) => !prev)}
                    disabled={isUpdating("add_custom_provider")}
                  >
                    {showAdd ? "取消创建" : "+ 创建自定义 Provider"}
                  </Button>
                </div>
                {showAdd && (
                  <div className="space-y-4 rounded-lg border border-mid-gray/20 bg-background/50 p-5 shadow-sm">
                    <h3 className="text-sm font-medium text-text">
                      创建自定义 Provider
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1 md:col-span-2">
                        <label className="text-xs font-medium text-mid-gray/80">
                          Provider 名称
                        </label>
                        <TextField.Root
                          
                          
                          value={addDraft.label}
                          onChange={(event) =>
                            setAddDraft((draft) => ({
                              ...draft,
                              label: event.target.value,
                            }))
                          }
                          placeholder="Provider 名称（例如 Custom Whisper）"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-mid-gray/80">
                          Base URL
                        </label>
                        <TextField.Root
                          className="w-full"
                          size="1"
                          value={addDraft.baseUrl}
                          onChange={(event) =>
                            setAddDraft((draft) => ({
                              ...draft,
                              baseUrl: event.target.value,
                            }))
                          }
                          placeholder="https://..."
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-mid-gray/80">
                          Models Endpoint
                        </label>
                        <TextField.Root
                          className="w-full"
                          size="1"
                          value={addDraft.modelsEndpoint}
                          onChange={(event) =>
                            setAddDraft((draft) => ({
                              ...draft,
                              modelsEndpoint: event.target.value,
                            }))
                          }
                          placeholder="/models"
                        />
                      </div>
                    </div>
                      <div className="flex justify-end gap-3 pt-2">
                        <Button
                          variant="ghost"
                          size="1"
                          onClick={() => {
                            setShowAdd(false);
                          }}
                        >
                          取消
                        </Button>
                        <Button
                          variant="solid"
                          size="1"
                          disabled={!canAdd || isUpdating("add_custom_provider")}
                          onClick={handleAdd}
                        >
                          创建 Provider
                        </Button>
                      </div>
                  </div>
                )}

                <div className="grid gap-3">
                  {customProviders.map((provider) => {
                    const isEditing = editingId === provider.id;
                    const updating =
                      isUpdating(`update_custom_provider:${provider.id}`) ||
                      isUpdating(`remove_custom_provider:${provider.id}`);
                    return (
                      <div
                        key={provider.id}
                        className="rounded-lg border border-mid-gray/20 bg-background/30 p-4 shadow-sm space-y-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-text truncate">
                              {provider.label}
                            </p>
                            <p className="text-xs text-mid-gray/70 mt-1">
                              ID: {provider.id}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            {!isEditing && (
                              <div className="flex gap-1">
                                <Button
                                  variant="outline"
                                  size="1"
                                  onClick={() => handleStartEdit(provider)}
                                  disabled={updating}
                                >
                                  编辑
                                </Button>
                                <div className="relative">
                                  <Button
                                    variant="ghost"
                                    size="1"
                                    onClick={() =>
                                      setShowDeleteTooltip(provider.id)
                                    }
                                    disabled={updating}
                                    className="text-red-600 hover:text-red-700"
                                  >
                                    删除
                                  </Button>
                                  {showDeleteTooltip === provider.id && (
                                    <div
                                      ref={tooltipRef}
                                      className="absolute bottom-full right-0 mb-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg shadow-lg z-50 min-w-[200px] whitespace-normal"
                                    >
                                      <p className="text-sm font-medium text-red-700 mb-2">
                                        确认删除？
                                      </p>
                                      <p className="text-xs text-red-600 mb-3">
                                        这会移除该 Provider 的 API
                                        key、已缓存模型、ASR/Prompt 选择。
                                      </p>
                                      <div className="flex justify-end gap-2">
                                        <Button
                                          variant="ghost"
                                          size="1"
                                          onClick={() =>
                                            setShowDeleteTooltip(null)
                                          }
                                        >
                                          取消
                                        </Button>
                                        <Button
                                          variant="ghost"
                                          color="red"
                                          size="1"
                                          onClick={() =>
                                            handleRemove(provider.id)
                                          }
                                          disabled={updating}
                                        >
                                          删除
                                        </Button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-mid-gray/70">
                            <span className="font-medium">Base URL:</span>{" "}
                            {provider.base_url}
                          </p>
                          <p className="text-xs text-mid-gray/70">
                            <span className="font-medium">
                              Models endpoint:
                            </span>{" "}
                            {provider.models_endpoint ||
                              DEFAULT_MODELS_ENDPOINT}
                          </p>
                        </div>
                        {isEditing && (
                          <div className="space-y-3 pt-3 border-t border-mid-gray/20">
                            <h4 className="text-sm font-medium text-text">
                              编辑 Provider
                            </h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <div className="space-y-1 md:col-span-2">
                                <label className="text-xs font-medium text-mid-gray/80">
                                  Provider 名称
                                </label>
                                <TextField.Root
                                  className="w-full"
                                  size="1"
                                  value={editDraft.label}
                                  onChange={(event) =>
                                    setEditDraft((draft) => ({
                                      ...draft,
                                      label: event.target.value,
                                    }))
                                  }
                                  placeholder="Provider 名称"
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-xs font-medium text-mid-gray/80">
                                  Base URL
                                </label>
                                <TextField.Root
                                  className="w-full"
                                  size="1"
                                  value={editDraft.baseUrl}
                                  onChange={(event) =>
                                    setEditDraft((draft) => ({
                                      ...draft,
                                      baseUrl: event.target.value,
                                    }))
                                  }
                                  placeholder="https://..."
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-xs font-medium text-mid-gray/80">
                                  Models Endpoint
                                </label>
                                <TextField.Root
                                  className="w-full"
                                  size="1"
                                  value={editDraft.modelsEndpoint}
                                  onChange={(event) =>
                                    setEditDraft((draft) => ({
                                      ...draft,
                                      modelsEndpoint: event.target.value,
                                    }))
                                  }
                                  placeholder="/models"
                                />
                              </div>
                            </div>
                            <div className="flex justify-end gap-3 pt-2">
                              <Button
                                variant="ghost"
                                size="1"
                                onClick={() => setEditingId(null)}
                                disabled={updating}
                              >
                                取消
                              </Button>
                              <Button
                                variant="solid"
                                size="1"
                                disabled={!canSaveEdit || updating}
                                onClick={handleSaveEdit}
                              >
                                保存更改
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProviderManager;
