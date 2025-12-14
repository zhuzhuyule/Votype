import { Box, Button, Flex, Switch, Text, TextField } from "@radix-ui/themes";
import { invoke } from "@tauri-apps/api/core";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../../hooks/useSettings";
import type { ModelInfo } from "../../../lib/types";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { SettingContainer } from "../../ui/SettingContainer";

export const AsrModelsSettings: React.FC = () => {
  const { t } = useTranslation();
  const { settings, updateSetting } = useSettings();
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hiddenSet = useMemo(
    () => new Set(settings?.hidden_transcription_models ?? []),
    [settings?.hidden_transcription_models],
  );

  const refreshModels = async () => {
    const list = await invoke<ModelInfo[]>("get_available_models");
    setModels(list);
  };

  useEffect(() => {
    refreshModels();
  }, []);

  const addFromUrl = async () => {
    const value = url.trim();
    if (!value) return;

    setBusy(true);
    setError(null);
    try {
      const modelId = await invoke<string>("add_model_from_url", { url: value });
      setUrl("");
      await refreshModels();
      await invoke("download_model", { modelId });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleVisibility = async (modelId: string, showInQuickList: boolean) => {
    const current = new Set(settings?.hidden_transcription_models ?? []);
    if (showInQuickList) {
      current.delete(modelId);
    } else {
      current.add(modelId);
    }
    await updateSetting("hidden_transcription_models", Array.from(current));
  };

  const deleteModelFiles = async (modelId: string) => {
    setBusy(true);
    setError(null);
    try {
      await invoke("delete_model", { modelId });
      await refreshModels();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const downloadModel = async (modelId: string) => {
    setBusy(true);
    setError(null);
    try {
      await invoke("download_model", { modelId });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const transcriptionModels = useMemo(
    () => models.filter((m) => m.engine_type !== "SherpaOnnxPunctuation"),
    [models],
  );

  return (
    <SettingsGroup
      title={t("settings.asrModels.title")}
      description={t("settings.asrModels.description")}
    >
      <Box className="space-y-4">
        <Flex gap="2" align="center" wrap="wrap">
          <Box className="flex-1 min-w-[320px]">
            <TextField.Root
              placeholder="https://…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addFromUrl();
                }
              }}
            />
          </Box>
          <Button onClick={addFromUrl} disabled={busy || !url.trim()}>
            {t("settings.asrModels.addFromUrl")}
          </Button>
        </Flex>

        {error ? (
          <Text size="2" color="red">
            {error}
          </Text>
        ) : null}

        <Box className="space-y-2">
          {transcriptionModels.map((m) => {
            const showInQuickList = !hiddenSet.has(m.id);
            return (
              <SettingContainer
                key={m.id}
                title={m.name}
                description={`${m.id}${m.sherpa ? ` · ${m.sherpa.mode}/${m.sherpa.family}` : ""}`}
                descriptionMode="inline"
                grouped
              >
                <Flex gap="3" align="center">
                  <Flex direction="column" align="end">
                    <Text size="1" color="gray">
                      {t("settings.asrModels.showInQuickList")}
                    </Text>
                    <Switch
                      checked={showInQuickList}
                      onCheckedChange={(checked) => toggleVisibility(m.id, checked)}
                    />
                  </Flex>
                  <Button
                    size="1"
                    variant="soft"
                    onClick={() => downloadModel(m.id)}
                    disabled={busy || m.is_downloaded || !m.url}
                  >
                    {t("settings.asrModels.download")}
                  </Button>
                  <Button
                    size="1"
                    color="red"
                    variant="soft"
                    onClick={() => deleteModelFiles(m.id)}
                    disabled={busy || !m.is_downloaded}
                  >
                    {t("settings.asrModels.delete")}
                  </Button>
                </Flex>
              </SettingContainer>
            );
          })}
        </Box>
      </Box>
    </SettingsGroup>
  );
};

