import { invoke } from "@tauri-apps/api/core";
import React from "react";
import {
  Button,
  Dialog,
  Flex,
  Switch,
  Text,
  TextArea,
  TextField,
} from "@radix-ui/themes";
import { useTranslation } from "react-i18next";
import type { CachedModel } from "../../../../lib/types";

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
  const [extraParams, setExtraParams] = React.useState(
    model.extra_params ? JSON.stringify(model.extra_params, null, 2) : "",
  );
  const [extraHeaders, setExtraHeaders] = React.useState(
    model.extra_headers ? JSON.stringify(model.extra_headers, null, 2) : "",
  );
  const [thinking, setThinking] = React.useState(model.is_thinking_model);
  const [role, setRole] = React.useState(model.prompt_message_role || "system");
  const [saving, setSaving] = React.useState(false);

  // Auto-detect thinking support
  const [supportsThinking, setSupportsThinking] = React.useState(false);
  React.useEffect(() => {
    invoke<string | null>("get_thinking_config", {
      modelId: model.model_id,
      providerId: model.provider_id,
      enabled: true,
      modelName: model.name || null,
      customLabel: model.custom_label || label || null,
    }).then((config) => setSupportsThinking(config !== null));
  }, [
    model.model_id,
    model.provider_id,
    model.name,
    model.custom_label,
    label,
  ]);

  const handleThinkingToggle = async (enabled: boolean) => {
    setThinking(enabled);
    try {
      const config = await invoke<string | null>("get_thinking_config", {
        modelId: model.model_id,
        providerId: model.provider_id,
        enabled,
        modelName: model.name || null,
        customLabel: model.custom_label || label || null,
      });
      if (config) {
        // Merge with existing params
        const existing = extraParams.trim() ? JSON.parse(extraParams) : {};
        const thinkingParams = JSON.parse(config);
        setExtraParams(
          JSON.stringify({ ...existing, ...thinkingParams }, null, 2),
        );
      }
    } catch {
      // Ignore
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await invoke("update_cached_model", {
        id: model.id,
        customLabel: label,
        extraParams: extraParams.trim() || null,
        extraHeaders: extraHeaders.trim() || null,
        isThinkingModel: thinking,
        promptMessageRole: role,
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
      <Dialog.Content maxWidth="450px">
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

          {/* Developer Mode */}
          <Flex align="center" justify="between">
            <Text size="2" weight="medium" color="gray">
              {t(
                "settings.postProcessing.models.promptMessageRole.label",
                "Developer mode",
              )}
            </Text>
            <Switch
              size="1"
              checked={role === "developer"}
              onCheckedChange={(checked) =>
                setRole(checked ? "developer" : "system")
              }
            />
          </Flex>

          {/* Thinking Mode */}
          {supportsThinking && (
            <Flex align="center" justify="between">
              <Text size="2" weight="medium" color="gray">
                {t(
                  "settings.postProcessing.models.thinkingMode.label",
                  "Thinking",
                )}
              </Text>
              <Switch
                size="1"
                checked={thinking}
                onCheckedChange={(checked) => handleThinkingToggle(!!checked)}
              />
            </Flex>
          )}

          {/* Extra Params (Body) */}
          <Flex direction="column" gap="1">
            <Flex justify="between" align="baseline">
              <Text size="2" weight="medium" color="gray">
                Body
              </Text>
              <Text size="1" color="gray">
                JSON
              </Text>
            </Flex>
            <TextArea
              value={extraParams}
              onChange={(e) => setExtraParams(e.target.value)}
              placeholder='e.g. {"chat_template_kwargs": {"enable_thinking": false}}'
              className="font-mono text-xs bg-(--gray-2)"
              rows={3}
            />
          </Flex>

          {/* Extra Headers */}
          <Flex direction="column" gap="1">
            <Flex justify="between" align="baseline">
              <Text size="2" weight="medium" color="gray">
                Headers
              </Text>
              <Text size="1" color="gray">
                JSON
              </Text>
            </Flex>
            <TextArea
              value={extraHeaders}
              onChange={(e) => setExtraHeaders(e.target.value)}
              placeholder='e.g. {"X-Custom-Auth": "token"}'
              className="font-mono text-xs bg-(--gray-2)"
              rows={2}
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
