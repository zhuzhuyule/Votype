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
import { invoke } from "@tauri-apps/api/core";
import React from "react";
import { useTranslation } from "react-i18next";
import type { CachedModel } from "../../../../lib/types";
import {
  KeyValueEditor,
  type KeyValueEditorHandle,
} from "../../../ui/KeyValueEditor";

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
  const [extraParams, setExtraParams] = React.useState<Record<string, unknown>>(
    model.extra_params || {},
  );
  const [extraHeaders, setExtraHeaders] = React.useState<
    Record<string, unknown>
  >(model.extra_headers || {});
  // Derive thinking state from extraParams content, not a separate flag
  const thinking = React.useMemo(() => {
    const p = extraParams;
    // {"thinking": {"type": "enabled"}}
    if (p.thinking && typeof p.thinking === "object" && (p.thinking as any).type === "enabled") return true;
    // {"chat_template_kwargs": {"enable_thinking": true}}
    if (p.chat_template_kwargs && typeof p.chat_template_kwargs === "object" && (p.chat_template_kwargs as any).enable_thinking === true) return true;
    // {"enable_thinking": true}
    if (p.enable_thinking === true) return true;
    // {"reasoning_effort": "high"}
    if (p.reasoning_effort === "high") return true;
    return false;
  }, [extraParams]);
  const [saving, setSaving] = React.useState(false);
  const bodyEditorRef = React.useRef<KeyValueEditorHandle>(null);
  const headersEditorRef = React.useRef<KeyValueEditorHandle>(null);
  const [bodyEntryCount, setBodyEntryCount] = React.useState(
    Object.keys(model.extra_params || {}).length,
  );
  const [headerEntryCount, setHeaderEntryCount] = React.useState(
    Object.keys(model.extra_headers || {}).length,
  );
  const [modelFamily, setModelFamily] = React.useState<string>(
    model.model_family || "",
  );
  const [modelFamilies, setModelFamilies] = React.useState<[string, string][]>(
    [],
  );
  const [presetParamsHint, setPresetParamsHint] = React.useState<string>("");

  const [thinkingEnableParams, setThinkingEnableParams] = React.useState<Record<
    string,
    unknown
  > | null>(null);
  const [thinkingDisableParams, setThinkingDisableParams] =
    React.useState<Record<string, unknown> | null>(null);
  const [supportsThinking, setSupportsThinking] = React.useState(false);

  const effectiveLabel = model.custom_label || label || "";
  React.useEffect(() => {
    const aliases = {
      modelId: model.model_id,
      providerId: model.provider_id,
      modelName: model.name || null,
      customLabel: effectiveLabel || null,
      modelFamily: modelFamily || null,
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
  }, [
    model.model_id,
    model.provider_id,
    model.name,
    effectiveLabel,
    modelFamily,
  ]);

  React.useEffect(() => {
    invoke<[string, string][]>("get_model_families")
      .then((families) => setModelFamilies(families))
      .catch(() => setModelFamilies([]));
  }, []);

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

          {/* Body 参数 */}
          <Flex direction="column" gap="1">
            <Flex align="center" gap="2" wrap="wrap">
              <Text size="2" weight="medium" color="gray">
                Body 参数
              </Text>
              {bodyEntryCount > 0 && (
                <Tooltip content="添加参数">
                  <IconButton
                    size="1"
                    variant="outline"
                    className="h-5! w-5!"
                    color="gray"
                    onClick={() => bodyEditorRef.current?.addEntry()}
                  >
                    <IconPlus size={12} />
                  </IconButton>
                </Tooltip>
              )}
              <Button
                size="1"
                variant="soft"
                color="blue"
                onClick={() => {
                  const params = thinkingEnableParams || { thinking: { type: "enabled" } };
                  setExtraParams((prev) => ({ ...prev, ...params }));
                }}
              >
                <IconBrain size={12} />
                启用思考
              </Button>
              <Button
                size="1"
                variant="soft"
                color="orange"
                onClick={() => {
                  const params = thinkingDisableParams || { thinking: { type: "disabled" } };
                  setExtraParams((prev) => ({ ...prev, ...params }));
                }}
              >
                <IconBrain size={12} />
                禁用思考
              </Button>
            </Flex>
            <KeyValueEditor
              value={extraParams}
              onChange={setExtraParams}
              addLabel="添加 Body 参数"
              addTooltip="添加参数"
              addRef={bodyEditorRef}
              onEntryCountChange={setBodyEntryCount}
            />
          </Flex>

          {/* Headers */}
          <Flex direction="column" gap="1">
            <Flex align="center" gap="2">
              <Text size="2" weight="medium" color="gray">
                Headers
              </Text>
              {headerEntryCount > 0 && (
                <Tooltip content="添加 Header">
                  <IconButton
                    size="1"
                    variant="outline"
                    color="gray"
                    className="h-5! w-5!"
                    onClick={() => headersEditorRef.current?.addEntry()}
                  >
                    <IconPlus size={12} />
                  </IconButton>
                </Tooltip>
              )}
            </Flex>
            <KeyValueEditor
              value={extraHeaders}
              onChange={setExtraHeaders}
              addLabel="添加 Header"
              addTooltip="添加 Header"
              addRef={headersEditorRef}
              onEntryCountChange={setHeaderEntryCount}
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
