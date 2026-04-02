import { invoke } from "@tauri-apps/api/core";
import React from "react";
import {
  Button,
  Dialog,
  Flex,
  Select,
  Text,
  TextField,
} from "@radix-ui/themes";
import { IconBrain } from "@tabler/icons-react";
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
  const [modelFamily, setModelFamily] = React.useState<string>(
    model.model_family || "",
  );
  const [modelFamilies, setModelFamilies] = React.useState<
    [string, string][]
  >([]);
  const [presetParamsHint, setPresetParamsHint] = React.useState<string>("");

  // Thinking config cache (enable/disable params for this model)
  const [thinkingEnableParams, setThinkingEnableParams] =
    React.useState<Record<string, unknown> | null>(null);
  const [thinkingDisableParams, setThinkingDisableParams] =
    React.useState<Record<string, unknown> | null>(null);

  // Auto-detect thinking support and cache both enable/disable configs
  const [supportsThinking, setSupportsThinking] = React.useState(false);
  React.useEffect(() => {
    const aliases = {
      modelId: model.model_id,
      providerId: model.provider_id,
      modelName: model.name || null,
      customLabel: model.custom_label || label || null,
    };
    // Fetch enable config
    invoke<string | null>("get_thinking_config", {
      ...aliases,
      enabled: true,
    }).then((config) => {
      setSupportsThinking(config !== null);
      if (config) {
        try {
          setThinkingEnableParams(JSON.parse(config));
        } catch {
          setThinkingEnableParams(null);
        }
      }
    });
    // Fetch disable config
    invoke<string | null>("get_thinking_config", {
      ...aliases,
      enabled: false,
    }).then((config) => {
      if (config) {
        try {
          setThinkingDisableParams(JSON.parse(config));
        } catch {
          setThinkingDisableParams(null);
        }
      }
    });
  }, [model.model_id, model.provider_id, model.name, model.custom_label, label]);

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

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Content maxWidth="540px">
        <Dialog.Title>
          {t("common.edit", "Edit")} - {model.model_id}
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
            <Flex align="center" gap="2">
              <Text size="2" weight="medium" color="gray">
                模型系列
              </Text>
              {supportsThinking && (
                <IconBrain
                  size={15}
                  style={{
                    color: thinking
                      ? "var(--blue-9)"
                      : "var(--gray-8)",
                    cursor: "pointer",
                    opacity: thinking ? 1 : 0.5,
                  }}
                  onClick={() => handleThinkingToggle(!thinking)}
                  title={thinking ? "Thinking 已启用" : "Thinking 已禁用"}
                />
              )}
            </Flex>
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

          {/* Extra Params (Body) - Key-Value Editor */}
          <Flex direction="column" gap="1">
            <Text size="2" weight="medium" color="gray">
              Body 参数
            </Text>
            <KeyValueEditor
              value={extraParams}
              onChange={setExtraParams}
              quickActions={bodyQuickActions}
            />
            <Text size="1" color="gray" mt="1" as="div">
              手动设置的参数将覆盖预设值
            </Text>
          </Flex>

          {/* Extra Headers - Key-Value Editor */}
          <Flex direction="column" gap="1">
            <Text size="2" weight="medium" color="gray">
              Headers
            </Text>
            <KeyValueEditor
              value={extraHeaders}
              onChange={setExtraHeaders}
              placeholder="添加 Header"
            />
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
