import { invoke } from "@tauri-apps/api/core";
import React from "react";
import {
  Button,
  Dialog,
  Flex,
  IconButton,
  Select,
  Text,
  TextField,
  Tooltip,
} from "@radix-ui/themes";
import { IconBrain, IconPlus } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import type { CachedModel } from "../../../../lib/types";
import { KeyValueEditor, type QuickAction } from "../../../ui/KeyValueEditor";

export interface EditModelDialogProps {
  model: CachedModel;
  onClose: () => void;
  onSave: () => Promise<void>;
}

export const EditModelDialog: React.FC<EditModelDialogProps> = ({
  model,
  onClose,
  onSave,
}) => {
  const { t } = useTranslation();
  const [label, setLabel] = React.useState(model.custom_label || "");
  const [extraParams, setExtraParams] = React.useState<
    Record<string, unknown>
  >(model.extra_params || {});
  const [extraHeaders, setExtraHeaders] = React.useState<
    Record<string, unknown>
  >(model.extra_headers || {});
  const [thinking, setThinking] = React.useState(model.is_thinking_model);
  const [saving, setSaving] = React.useState(false);
  const bodyEditorRef = React.useRef<{ addEntry: () => void }>(null);
  const headersEditorRef = React.useRef<{ addEntry: () => void }>(null);
  const [modelFamily, setModelFamily] = React.useState<string>(
    model.model_family || "",
  );
  const [modelFamilies, setModelFamilies] = React.useState<
    [string, string][]
  >([]);
  const [presetParamsHint, setPresetParamsHint] = React.useState<string>("");

  // Thinking config cache
  const [thinkingEnableParams, setThinkingEnableParams] =
    React.useState<Record<string, unknown> | null>(null);
  const [thinkingDisableParams, setThinkingDisableParams] =
    React.useState<Record<string, unknown> | null>(null);
  const [supportsThinking, setSupportsThinking] = React.useState(false);

  // Fetch thinking configs — re-run when model family changes (different families have different params)
  const effectiveLabel = model.custom_label || label || "";
  React.useEffect(() => {
    const aliases = {
      modelId: model.model_id,
      providerId: model.provider_id,
      modelName: model.name || null,
      customLabel: effectiveLabel || null,
    };
    invoke<string | null>("get_thinking_config", {
      ...aliases,
      enabled: true,
    }).then((config) => {
      setSupportsThinking(config !== null);
      try {
        setThinkingEnableParams(config ? JSON.parse(config) : null);
      } catch {
        setThinkingEnableParams(null);
      }
    });
    invoke<string | null>("get_thinking_config", {
      ...aliases,
      enabled: false,
    }).then((config) => {
      try {
        setThinkingDisableParams(config ? JSON.parse(config) : null);
      } catch {
        setThinkingDisableParams(null);
      }
    });
  }, [model.model_id, model.provider_id, model.name, effectiveLabel, modelFamily]);

  // Load model families on mount
  React.useEffect(() => {
    invoke<[string, string][]>("get_model_families")
      .then((families) => setModelFamilies(families))
      .catch(() => setModelFamilies([]));
  }, []);

  // Load preset params hint when family changes
  React.useEffect(() => {
    if (!modelFamily) {
      setPresetParamsHint("");
      return;
    }
    invoke<Record<string, unknown>>("get_preset_params", {
      familyId: modelFamily,
      presetName: "balanced",
    })
      .then((params) => {
        const entries = Object.entries(params);
        setPresetParamsHint(
          entries.length > 0
            ? entries.map(([k, v]) => `${k}: ${v}`).join(" | ")
            : "",
        );
      })
      .catch(() => setPresetParamsHint(""));
  }, [modelFamily]);

  const handleThinkingToggle = async (enabled: boolean) => {
    setThinking(enabled);
    const params = enabled ? thinkingEnableParams : thinkingDisableParams;
    if (params) {
      setExtraParams((prev) => ({ ...prev, ...params }));
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const paramsStr =
        Object.keys(extraParams).length > 0
          ? JSON.stringify(extraParams)
          : null;
      const headersStr =
        Object.keys(extraHeaders).length > 0
          ? JSON.stringify(extraHeaders)
          : null;
      await invoke("update_cached_model", {
        id: model.id,
        customLabel: label,
        extraParams: paramsStr,
        extraHeaders: headersStr,
        isThinkingModel: thinking,
        promptMessageRole: model.prompt_message_role || "system",
      });
      await invoke("update_cached_model_family", {
        id: model.id,
        modelFamily: modelFamily.trim() || null,
      });
      await onSave();
    } catch (e) {
      console.error("Failed to update model:", e);
    } finally {
      setSaving(false);
    }
  };

  // Build quick actions for Body params
  const bodyQuickActions = React.useMemo<QuickAction[]>(() => {
    const actions: QuickAction[] = [];
    if (supportsThinking) {
      if (thinkingEnableParams) {
        actions.push({
          label: "启用思考",
          icon: <IconBrain size={12} />,
          color: "blue",
          getEntries: () => {
            setThinking(true);
            return thinkingEnableParams;
          },
        });
      }
      if (thinkingDisableParams) {
        actions.push({
          label: "禁用思考",
          icon: <IconBrain size={12} />,
          color: "orange",
          getEntries: () => {
            setThinking(false);
            return thinkingDisableParams;
          },
        });
      }
    }
    return actions;
  }, [supportsThinking, thinkingEnableParams, thinkingDisableParams]);

  const hasBodyParams = Object.keys(extraParams).length > 0;
  const hasHeaders = Object.keys(extraHeaders).length > 0;

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Content maxWidth="540px">
        <Dialog.Title>
          <Flex align="center" gap="2">
            {t("common.edit", "Edit")} - {model.model_id}
            {thinking && (
              <IconBrain
                size={16}
                style={{ color: "var(--blue-9)" }}
                title="Thinking 已启用"
              />
            )}
          </Flex>
        </Dialog.Title>

        <Flex direction="column" gap="4" mt="3">
          {/* Display Name */}
          <Flex direction="column" gap="1">
            <Text size="2" weight="medium" color="gray">
              {t(
                "settings.postProcessing.models.selectModel.customLabel",
                "Display Name",
              )}
            </Text>
            <TextField.Root
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={model.model_id}
            />
          </Flex>

          {/* Model Family */}
          <Flex direction="column" gap="1">
            <Text size="2" weight="medium" color="gray">
              模型系列
            </Text>
            <Select.Root
              value={modelFamily || "__unknown__"}
              onValueChange={(v) =>
                setModelFamily(v === "__unknown__" ? "" : v)
              }
            >
              <Select.Trigger className="w-full" />
              <Select.Content>
                <Select.Item value="__unknown__">未知</Select.Item>
                {modelFamilies.map(([id, displayName]) => (
                  <Select.Item key={id} value={id}>
                    {displayName}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
          </Flex>
          {presetParamsHint && (
            <Text size="1" color="gray" mt="-2" as="div">
              预设参数: {presetParamsHint}
            </Text>
          )}

          {/* Extra Params (Body) */}
          <Flex direction="column" gap="1">
            <Flex align="center" gap="2">
              <Text size="2" weight="medium" color="gray">
                Body 参数
              </Text>
              {hasBodyParams && (
                <Tooltip content="添加参数">
                  <IconButton
                    size="1"
                    variant="outline"
                    color="gray"
                    onClick={() => bodyEditorRef.current?.addEntry()}
                  >
                    <IconPlus size={12} />
                  </IconButton>
                </Tooltip>
              )}
            </Flex>
            {hasBodyParams ? (
              <KeyValueEditor
                value={extraParams}
                onChange={setExtraParams}
                quickActions={bodyQuickActions}
                hideAddButton
                addRef={bodyEditorRef}
              />
            ) : (
              <Flex direction="column" gap="2">
                <Flex gap="2" wrap="wrap" align="center">
                  <Tooltip content="添加参数">
                    <IconButton
                      size="1"
                      variant="outline"
                      color="gray"
                      onClick={() => {
                        // Initialize editor with one empty entry
                        setExtraParams({ "": "" });
                        setTimeout(() => bodyEditorRef.current?.addEntry(), 0);
                      }}
                    >
                      <IconPlus size={12} />
                    </IconButton>
                  </Tooltip>
                  {bodyQuickActions.map((action, i) => (
                    <Button
                      key={i}
                      size="1"
                      variant="soft"
                      color={action.color || "blue"}
                      onClick={() => {
                        const entries = action.getEntries();
                        setExtraParams((prev) => ({ ...prev, ...entries }));
                      }}
                    >
                      {action.icon}
                      {action.label}
                    </Button>
                  ))}
                </Flex>
              </Flex>
            )}
          </Flex>

          {/* Extra Headers */}
          <Flex direction="column" gap="1">
            <Flex align="center" gap="2">
              <Text size="2" weight="medium" color="gray">
                Headers
              </Text>
              {hasHeaders && (
                <Tooltip content="添加 Header">
                  <IconButton
                    size="1"
                    variant="outline"
                    color="gray"
                    onClick={() => headersEditorRef.current?.addEntry()}
                  >
                    <IconPlus size={12} />
                  </IconButton>
                </Tooltip>
              )}
            </Flex>
            {hasHeaders ? (
              <KeyValueEditor
                value={extraHeaders}
                onChange={setExtraHeaders}
                hideAddButton
                addRef={headersEditorRef}
              />
            ) : (
              <Tooltip content="添加 Header">
                <IconButton
                  size="1"
                  variant="outline"
                  color="gray"
                  onClick={() => setExtraHeaders({ "": "" })}
                >
                  <IconPlus size={12} />
                </IconButton>
              </Tooltip>
            )}
          </Flex>

          <Flex justify="end" gap="3" mt="2">
            <Button variant="soft" color="gray" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button variant="solid" onClick={handleSave} disabled={saving}>
              {t("common.save", "Save")}
            </Button>
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
};
