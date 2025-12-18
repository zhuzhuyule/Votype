import {
  AlertDialog,
  Badge,
  Box,
  Button,
  Card,
  Dialog,
  Flex,
  Heading,
  IconButton,
  Separator,
  Switch,
  Text,
  TextField,
  Tooltip
} from "@radix-ui/themes";
import {
  IconDownload,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconStar,
  IconStarFilled,
  IconThumbUpFilled,
  IconTrash,
  IconX
} from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../../hooks/useSettings";
import type { ModelInfo } from "../../../lib/types";
import {
  getTranslatedModelDescription,
  getTranslatedModelName,
} from "../../../lib/utils/modelTranslation";
import { Dropdown } from "../../ui/Dropdown";
import { SettingsGroup } from "../../ui/SettingsGroup";

type StatusFilter = "all" | "downloaded" | "favorites" | "recommended";

type ModeKey = "streaming" | "offline" | "punctuation";

type TypeKey =
  | "whisper"
  | "parakeet"
  | "sherpa_transducer"
  | "sherpa_paraformer"
  | "sherpa_sense_voice"
  | "sherpa_fire_red_asr"
  | "punctuation"
  | "other";

type LanguageKey =
  | "zh"
  | "yue"
  | "en"
  | "ja"
  | "ko"
  | "de"
  | "es"
  | "fr"
  | "ru"
  | "multilingual"
  | "other";

const RECOMMENDED_MODEL_IDS = new Set([
  "sherpa-paraformer-zh-en-streaming",
  "sherpa-paraformer-trilingual-zh-cantonese-en",
  "sherpa-zipformer-small-ctc-zh-int8-2025-04-01",
  "punct-zh-en-ct-transformer-2024-04-12-int8",
  "sherpa-paraformer-zh-small-2024-03-09",
]);

const parseLanguageKeys = (model: ModelInfo): LanguageKey[] => {
  if (model.tags && model.tags.length > 0) {
    const knownKeys: LanguageKey[] = [
      "zh", "yue", "en", "ja", "ko", "de", "es", "fr", "ru", "multilingual", "other"
    ];
    const explicit = model.tags.filter(t => knownKeys.includes(t as LanguageKey)) as LanguageKey[];
    if (explicit.length > 0) return explicit;
  }

  const id = (model.id ?? "").toLowerCase();
  const tokenSet = new Set<LanguageKey>();

  if (id === "sherpa-paraformer-zh-small-2024-03-09") {
    return ["multilingual", "zh", "en"];
  }

  const re = /(^|[-_])(zh|yue|ct|cantonese|en|ja|ko|de|es|fr|ru)(?=([-_]|$))/g;
  for (const match of id.matchAll(re)) {
    const tok = match[2];
    if (tok === "ct" || tok === "cantonese") {
      tokenSet.add("yue");
    } else {
      tokenSet.add(tok as LanguageKey);
    }
  }

  const found = Array.from(tokenSet);
  if (found.length >= 2) return ["multilingual", ...found];
  if (found.length === 1) return found;
  return ["other"];
};

const getModeKey = (m: ModelInfo): ModeKey => {
  if (m.engine_type === "SherpaOnnxPunctuation") return "punctuation";
  if (m.engine_type === "SherpaOnnx" && m.sherpa?.mode === "Streaming") {
    return "streaming";
  }
  return "offline";
};

const getTypeKey = (m: ModelInfo): TypeKey => {
  if (m.engine_type === "Whisper") return "whisper";
  if (m.engine_type === "Parakeet") return "parakeet";
  if (m.engine_type === "SherpaOnnxPunctuation") return "punctuation";

  if (m.engine_type === "SherpaOnnx") {
    switch (m.sherpa?.family) {
      case "Transducer":
      case "Zipformer2Ctc":
        return "sherpa_transducer";
      case "Paraformer":
        return "sherpa_paraformer";
      case "SenseVoice":
        return "sherpa_sense_voice";
      case "FireRedAsr":
        return "sherpa_fire_red_asr";
      default:
        return "other";
    }
  }

  return "other";
};

const orderMode = (k: ModeKey) => {
  switch (k) {
    case "streaming":
      return 0;
    case "offline":
      return 1;
    case "punctuation":
      return 2;
  }
};

const orderType = (k: TypeKey) => {
  switch (k) {
    case "whisper":
      return 0;
    case "parakeet":
      return 1;
    case "sherpa_transducer":
      return 2;
    case "sherpa_paraformer":
      return 3;
    case "sherpa_sense_voice":
      return 4;
    case "sherpa_fire_red_asr":
      return 5;
    case "punctuation":
      return 6;
    case "other":
      return 99;
  }
};

const orderLanguage = (k: LanguageKey) => {
  switch (k) {
    case "multilingual":
      return 0;
    case "zh":
      return 1;
    case "en":
      return 2;
    case "yue":
      return 3;
    case "ja":
      return 4;
    case "ko":
      return 5;
    case "de":
      return 6;
    case "es":
      return 7;
    case "fr":
      return 8;
    case "ru":
      return 9;
    case "other":
      return 99;
  }
};

const sizeBucket = (
  sizeMb?: number,
): "small" | "medium" | "large" | "unknown" => {
  if (sizeMb == null || !Number.isFinite(sizeMb)) return "unknown";
  if (sizeMb < 100) return "small";
  if (sizeMb < 500) return "medium";
  return "large";
};

interface AsrModelsSettingsProps {
  className?: string;
  hideHeader?: boolean;
}

export const AsrModelsSettings: React.FC<AsrModelsSettingsProps> = ({ className, hideHeader = false }) => {
  const { t } = useTranslation();
  const { settings, updateSetting } = useSettings();

  const [models, setModels] = useState<ModelInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Add Dialog State
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editMode, setEditMode] = useState(false); // New state to track if we are editing
  const [url, setUrl] = useState("");
  const [addName, setAddName] = useState("");
  const [addTags, setAddTags] = useState<Set<string>>(new Set());
  const [customTagInput, setCustomTagInput] = useState("");
  const [query, setQuery] = useState("");

  // Remove confirmation dialog state
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);
  const [modelToRemove, setModelToRemove] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [modeFilter, setModeFilter] = useState<Set<ModeKey>>(
    () => new Set(["streaming", "offline", "punctuation"]),
  );
  const [languageFilter, setLanguageFilter] = useState<Set<LanguageKey>>(
    () => new Set(),
  );
  const [typeFilter, setTypeFilter] = useState<Set<TypeKey>>(() => new Set());

  const favoriteSet = useMemo(
    () => new Set(settings?.favorite_transcription_models ?? []),
    [settings?.favorite_transcription_models],
  );

  const punctuationModels = useMemo(() => {
    return models
      .filter((m) => m.engine_type === "SherpaOnnxPunctuation")
      .slice()
      .sort((a, b) => (a.size_mb ?? 0) - (b.size_mb ?? 0));
  }, [models]);

  const selectedPunctuationModelId =
    settings?.punctuation_model ?? "punct-zh-en-ct-transformer-2024-04-12-int8";

  const punctuationModelOptions = useMemo(() => {
    return punctuationModels.map((m) => ({
      value: m.id,
      label: `${getTranslatedModelName(m, t)} · ${m.size_mb} MB`,
      disabled: false,
    }));
  }, [punctuationModels, t]);

  const refreshModels = async () => {
    const list = await invoke<ModelInfo[]>("get_available_models");
    setModels(list);
  };

  useEffect(() => {
    refreshModels();
  }, []);

  const resetLibraryFilters = () => {
    setUrl("");
    setQuery("");
    setStatusFilter("all");
    setModeFilter(new Set(["streaming", "offline", "punctuation"]));
    setLanguageFilter(new Set());
    setTypeFilter(new Set());
    setError(null);
  };

  const openAddDialog = () => {
    setEditMode(false);
    setUrl("");
    setAddName("");
    setAddTags(new Set());
    setCustomTagInput("");
    setError(null);
    setIsAddDialogOpen(true);
  };

  const openEditDialog = (model: ModelInfo) => {
    setEditMode(true);
    // Use URL if available, or empty (but usually custom models have URL)
    setUrl(model.url || "");
    setAddName(model.name || "");
    setAddTags(new Set(model.tags || []));
    setCustomTagInput("");
    setError(null);
    setIsAddDialogOpen(true);
  };

  // Open the remove confirmation dialog
  const openRemoveConfirm = (modelId: string) => {
    setModelToRemove(modelId);
    setRemoveConfirmOpen(true);
  };

  // Perform the actual removal after user confirms
  const confirmRemoveModel = async () => {
    if (!modelToRemove) return;
    setRemoveConfirmOpen(false);
    setBusy(true);
    try {
      await invoke("remove_custom_model", { modelId: modelToRemove, deleteFiles: true });
      await refreshModels();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setModelToRemove(null);
    }
  };

  const addFromUrl = async () => {
    const value = url.trim();
    if (!value) return;

    setBusy(true);
    setError(null);
    try {
      const modelId = await invoke<string>("add_model_from_url", {
        url: value,
        name: addName.trim() || null,
        tags: addTags.size > 0 ? Array.from(addTags) : null,
      });
      setIsAddDialogOpen(false);
      setUrl("");
      setAddName("");
      setAddTags(new Set());
      await refreshModels();
      // Optional: auto download
      // await invoke("download_model", { modelId });
      // await refreshModels();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleAddTag = (tag: string) => {
    const next = new Set(addTags);
    if (next.has(tag)) next.delete(tag);
    else next.add(tag);
    setAddTags(next);
  };

  const addCustomTag = () => {
    const val = customTagInput.trim();
    if (val) {
      const next = new Set(addTags);
      next.add(val);
      setAddTags(next);
      setCustomTagInput("");
    }
  };

  const toggleFavorite = async (modelId: string) => {
    const current = new Set(settings?.favorite_transcription_models ?? []);
    if (current.has(modelId)) {
      current.delete(modelId);
    } else {
      current.add(modelId);
    }
    await updateSetting("favorite_transcription_models", Array.from(current));
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
      await refreshModels();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleSetValue = <T,>(set: Set<T>, value: T) => {
    const next = new Set(set);
    if (next.has(value)) {
      next.delete(value);
    } else {
      next.add(value);
    }
    return next;
  };

  const filteredModels = useMemo(() => {
    const q = query.trim().toLowerCase();

    let list = models;

    if (statusFilter === "downloaded") {
      list = list.filter((m) => m.is_downloaded);
    } else if (statusFilter === "favorites") {
      list = list.filter(
        (m) =>
          m.engine_type !== "SherpaOnnxPunctuation" && favoriteSet.has(m.id),
      );
    } else if (statusFilter === "recommended") {
      list = list.filter((m) => RECOMMENDED_MODEL_IDS.has(m.id));
    }

    list = list.filter((m) => modeFilter.has(getModeKey(m)));

    if (languageFilter.size > 0) {
      list = list.filter((m) => {
        const langs = parseLanguageKeys(m);
        const matchesSpecific = langs.some((l) => languageFilter.has(l));
        const matchesMultilingual =
          languageFilter.has("multilingual") && langs.includes("multilingual");
        return matchesSpecific || matchesMultilingual;
      });
    }

    if (typeFilter.size > 0) {
      list = list.filter((m) => typeFilter.has(getTypeKey(m)));
    }

    if (!q) return list;

    return list.filter((m) => {
      const name = getTranslatedModelName(m, t).toLowerCase();
      const id = m.id.toLowerCase();
      const desc = getTranslatedModelDescription(m, t).toLowerCase();
      return name.includes(q) || id.includes(q) || desc.includes(q);
    });
  }, [
    favoriteSet,
    languageFilter,
    modeFilter,
    models,
    query,
    statusFilter,
    t,
    typeFilter,
  ]);

  const groupsByMode = useMemo(() => {
    const groups = new Map<ModeKey, ModelInfo[]>();
    for (const m of filteredModels) {
      const k = getModeKey(m);
      groups.set(k, [...(groups.get(k) ?? []), m]);
    }

    for (const [k, list] of groups.entries()) {
      list.sort((a, b) => {
        const sizeA = a.size_mb ?? Number.POSITIVE_INFINITY;
        const sizeB = b.size_mb ?? Number.POSITIVE_INFINITY;
        if (sizeA !== sizeB) return sizeA - sizeB;
        return getTranslatedModelName(a, t).localeCompare(
          getTranslatedModelName(b, t),
        );
      });
      groups.set(k, list);
    }

    return Array.from(groups.entries()).sort(
      ([a], [b]) => orderMode(a) - orderMode(b),
    );
  }, [filteredModels, t]);

  const renderActions = (m: ModelInfo) => {
    const canFavorite = m.engine_type !== "SherpaOnnxPunctuation";
    const isFavorite = favoriteSet.has(m.id);

    return (
      <Flex gap="2" align="center" className="flex-shrink-0">
        <Tooltip content={t("settings.asrModels.favorite")}>
          <IconButton
            size="2"
            variant="ghost"
            onClick={() => toggleFavorite(m.id)}
            disabled={!canFavorite}
          >
            {isFavorite ? (
              <IconStarFilled className="w-4 h-4" />
            ) : (
              <IconStar className="w-4 h-4" />
            )}
          </IconButton>
        </Tooltip>

        {/* Custom Model Actions: Edit */}
        {!m.is_default && (
          <Tooltip content={t("settings.asrModels.install.editTitle") || "Edit Custom Model"}>
            <IconButton
              size="2"
              variant="ghost"
              onClick={() => openEditDialog(m)}
              disabled={busy}
            >
              <IconPencil className="w-4 h-4" />
            </IconButton>
          </Tooltip>
        )}

        {/* Download Action (for any model not downloaded) */}
        {!m.is_downloaded && (
          <Tooltip content={t("settings.asrModels.download")}>
            <IconButton
              size="2"
              variant="soft"
              onClick={() => downloadModel(m.id)}
              disabled={busy || !m.url}
            >
              <IconDownload className="w-4 h-4" />
            </IconButton>
          </Tooltip>
        )}

        {/* Delete downloaded files (for built-in models only) */}
        {m.is_default && m.is_downloaded && (
          <Tooltip content={t("settings.asrModels.delete")}>
            <IconButton
              size="2"
              color="red"
              variant="soft"
              onClick={() => deleteModelFiles(m.id)}
              disabled={busy}
            >
              <IconTrash className="w-4 h-4" />
            </IconButton>
          </Tooltip>
        )}

        {/* Remove custom model (entry + files) */}
        {!m.is_default && (
          <Tooltip content={t("settings.asrModels.install.remove") || "Remove custom model"}>
            <IconButton
              size="2"
              color="red"
              variant="soft"
              onClick={() => openRemoveConfirm(m.id)}
              disabled={busy}
            >
              <IconTrash className="w-4 h-4" />
            </IconButton>
          </Tooltip>
        )}
      </Flex>
    );
  };

  const renderModelRow = (m: ModelInfo) => {
    const title = getTranslatedModelName(m, t);
    const description = getTranslatedModelDescription(m, t);

    // ... (rest of variable definitions) ...
    const isRecommended = RECOMMENDED_MODEL_IDS.has(m.id);
    const languages = parseLanguageKeys(m);
    const isMultilingual = languages.includes("multilingual");
    const languageBadges = isMultilingual
      ? languages
        .filter((l) => l !== "multilingual" && l !== "other")
        .sort((a, b) => orderLanguage(a) - orderLanguage(b))
      : languages.filter((l) => l !== "other");

    const size = m.size_mb;
    const sizeText = size != null ? `${size} MB` : null;
    const sizeKind = sizeBucket(size);
    const sizeColor =
      sizeKind === "small"
        ? "green"
        : sizeKind === "medium"
          ? "amber"
          : sizeKind === "large"
            ? "red"
            : "gray";

    // Explicit TypeKey definition to fix scope issue if implied
    const typeKey = getTypeKey(m);

    // Simplify type chip display - remove "sherpa_" prefix for display
    const getSimpleTypeName = (key: TypeKey): string => {
      const translation = t(`settings.asrModels.typeChips.${key}`);
      // Remove "Sherpa " prefix if present since it's redundant
      return translation.replace(/^Sherpa\s+/i, "");
    };

    return (
      <Card key={m.id} variant="surface" className="p-3">
        <Flex justify="between" align="center" gap="3">
          <Box className="min-w-0 flex-1 space-y-1">
            {/* Line 1: Title + Recommended + ID */}
            <Flex align="center" gap="2" className="min-w-0">
              <Heading as="h3" size="3" weight="medium" className="text-gray-900 dark:text-gray-100 truncate flex-shrink-0">
                {title}
              </Heading>
              {isRecommended && (
                <Tooltip content={t("onboarding.recommended")}>
                  <IconThumbUpFilled className="w-4 h-4 text-amber-500 flex-shrink-0" />
                </Tooltip>
              )}
              <Text size="1" className="text-gray-400 dark:text-gray-500 font-mono truncate">
                {m.id}
              </Text>
            </Flex>

            {/* Line 2: Size, Language, Type badges */}
            <Flex align="center" gap="1" wrap="wrap">
              {sizeText && (
                <Badge variant="soft" color={sizeColor} size="1">
                  {sizeText}
                </Badge>
              )}
              {languageBadges.map((l) => (
                <Badge key={`${m.id}:lang:${l}`} variant="soft" color="gray" size="1">
                  {t(`settings.asrModels.languages.${l}`)}
                </Badge>
              ))}
              <Badge variant="soft" color="gray" size="1">
                {getSimpleTypeName(typeKey)}
              </Badge>
            </Flex>
          </Box>

          {/* Right section: Actions */}
          <Box className="flex-shrink-0">{renderActions(m)}</Box>
        </Flex>
      </Card>
    );
  };

  const allLanguageKeys: LanguageKey[] = [
    "zh",
    "en",
    "yue",
    "ja",
    "ko",
    "de",
    "es",
    "fr",
    "ru",
    "multilingual",
    "other",
  ];

  const typeKeys: TypeKey[] = [
    "whisper",
    "parakeet",
    "sherpa_transducer",
    "sherpa_paraformer",
    "sherpa_sense_voice",
    "sherpa_fire_red_asr",
    "punctuation",
    "other",
  ];

  return (
    <Flex direction="column" className={`w - full mx - auto space - y - 8 pb - 10 ${className || "max-w-5xl"} `}>
      {!hideHeader && (
        <Box mb="4" px="1">
          <Heading size="4" weight="bold" highContrast style={{ color: "var(--gray-12)" }}>
            {t("settings.asrModels.title")}
          </Heading>
          <Text size="2" color="gray" mt="1" style={{ display: 'block' }}>
            {t("settings.asrModels.description")}
          </Text>
        </Box>
      )}

      <Box className="space-y-8">
        {/* Quick Settings Group */}
        <SettingsGroup title={t("settings.asrModels.quickSettings.title")}>
          <Flex direction="column" gap="4" py="2">
            <Flex justify="between" align="center" gap="3" wrap="wrap">
              <Box>
                <Text size="2" weight="medium">
                  {t("settings.asrModels.pipeline.punctuation")}
                </Text>
                <Text size="1" color="gray" style={{ display: 'block' }}>
                  {t("settings.asrModels.pipeline.punctuationHint")}
                </Text>
              </Box>
              <Switch
                checked={settings?.punctuation_enabled ?? false}
                onCheckedChange={(checked) =>
                  updateSetting("punctuation_enabled", checked)
                }
              />
            </Flex>

            {settings?.punctuation_enabled ? (
              <Flex justify="between" align="center" gap="3" wrap="wrap">
                <Box>
                  <Text size="2" weight="medium">
                    {t("settings.asrModels.pipeline.punctuationModel")}
                  </Text>
                  <Text size="1" color="gray" style={{ display: 'block' }}>
                    {t("settings.asrModels.pipeline.punctuationModelHint")}
                  </Text>
                </Box>
                <Dropdown
                  options={punctuationModelOptions}
                  selectedValue={selectedPunctuationModelId}
                  onSelect={(value) =>
                    updateSetting("punctuation_model", value)
                  }
                  disabled={busy || punctuationModelOptions.length === 0}
                  enableFilter={false}
                />
              </Flex>
            ) : null}

            <Flex justify="between" align="center" gap="3" wrap="wrap">
              <Box>
                <Text size="2" weight="medium">
                  {t("settings.asrModels.pipeline.itn")}
                </Text>
                <Text size="1" color="gray" style={{ display: 'block' }}>
                  {t("settings.asrModels.pipeline.itnHint")}
                </Text>
              </Box>
              <Switch
                checked={settings?.sense_voice_use_itn ?? true}
                onCheckedChange={(checked) =>
                  updateSetting("sense_voice_use_itn", checked)
                }
              />
            </Flex>
          </Flex>
        </SettingsGroup>

        {/* Library Group */}
        <SettingsGroup
          title={t("settings.asrModels.library.title")}
          description={t("settings.asrModels.library.description")}
          actions={
            <Badge variant="soft" color="gray">
              {t("settings.asrModels.library.count", {
                count: models.length,
              })}
            </Badge>
          }
        >
          <Flex direction="column" gap="4" py="2">
            <Flex gap="2" align="center" wrap="wrap">
              <Box className="flex-1 min-w-[220px]">
                <TextField.Root
                  placeholder={t(
                    "settings.asrModels.library.searchPlaceholder",
                  )}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                >
                  <TextField.Slot>
                    <IconSearch className="w-4 h-4" />
                  </TextField.Slot>
                </TextField.Root>
              </Box>

              <Dialog.Root open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
                <Dialog.Trigger>
                  <Button onClick={openAddDialog}>
                    <IconPlus size={16} />
                    {t("settings.asrModels.install.button")}
                  </Button>
                </Dialog.Trigger>
                <Dialog.Content style={{ maxWidth: 500 }}>
                  <Dialog.Title>
                    {editMode
                      ? (t("settings.asrModels.install.editTitle") || "Edit Custom Model")
                      : (t("settings.asrModels.install.title") || "Add Custom Model")}
                  </Dialog.Title>
                  <Dialog.Description size="2" mb="4">
                    {editMode
                      ? (t("settings.asrModels.install.editDescription") || "Update the name or tags for this model.")
                      : (t("settings.asrModels.install.description") || "Enter the URL of the model archive (tar.gz, tar.bz2, etc).")}
                  </Dialog.Description>

                  <Flex direction="column" gap="3">
                    <Box>
                      <Text as="div" size="2" mb="1" weight="bold">{t("settings.asrModels.install.urlLabel")}</Text>
                      <TextField.Root
                        placeholder={t("settings.asrModels.install.placeholder")}
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        disabled={editMode}
                      />
                    </Box>

                    <Box>
                      <Text as="div" size="2" mb="1" weight="bold">{t("settings.asrModels.install.nameLabel")}</Text>
                      <TextField.Root
                        placeholder="My Model"
                        value={addName}
                        onChange={(e) => setAddName(e.target.value)}
                      />
                    </Box>

                    <Box>
                      <Text as="div" size="2" mb="1" weight="bold">{t("settings.asrModels.install.tagsLabel")}</Text>
                      <Flex gap="2" wrap="wrap" mb="2">
                        {["multilingual", "zh", "en", "ja", "ko"].map(tag => (
                          <Badge
                            key={tag}
                            color={addTags.has(tag) ? "blue" : "gray"}
                            variant={addTags.has(tag) ? "solid" : "soft"}
                            style={{ cursor: "pointer" }}
                            onClick={() => toggleAddTag(tag)}
                          >
                            {t(`settings.asrModels.languages.${tag}`)}
                          </Badge>
                        ))}
                      </Flex>

                      <Flex gap="2">
                        <TextField.Root
                          className="flex-1"
                          placeholder={t("settings.asrModels.install.customTagPlaceholder")}
                          value={customTagInput}
                          onChange={(e) => setCustomTagInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              addCustomTag();
                            }
                          }}
                        />
                        <Tooltip content={t("settings.asrModels.install.addCustomTagButton")}>
                          <Button variant="soft" onClick={addCustomTag} disabled={!customTagInput.trim()}>
                            <IconPlus size={16} />
                          </Button>
                        </Tooltip>
                      </Flex>

                      {addTags.size > 0 && (
                        <Flex gap="2" wrap="wrap" mt="2">
                          {Array.from(addTags).map(tag => (
                            <Badge key={tag} variant="surface" color="blue">
                              {tag}
                              <IconX size={12} style={{ cursor: "pointer", marginLeft: 4 }} onClick={() => toggleAddTag(tag)} />
                            </Badge>
                          ))}
                        </Flex>
                      )}
                    </Box>

                    {error && (
                      <Text color="red" size="2">{error}</Text>
                    )}
                  </Flex>

                  <Flex gap="3" mt="4" justify="end">
                    <Dialog.Close>
                      <Button variant="soft" color="gray">
                        {t("common.cancel")}
                      </Button>
                    </Dialog.Close>
                    <Button onClick={addFromUrl} disabled={busy || !url.trim()}>
                      {busy
                        ? (editMode ? "Updating..." : "Adding...")
                        : (editMode ? (t("common.save") || "Save") : t("common.add"))}
                    </Button>
                  </Flex>
                </Dialog.Content>
              </Dialog.Root>
            </Flex>

            {/* Error shown outside dialog if needed (but dialog handles it now) - keeping generic error if useful */}
            {!isAddDialogOpen && error ? (
              <Text size="2" color="red">
                {error}
              </Text>
            ) : null}

            {/* Filters - Tag based for intuitive filtering */}
            <Flex direction="column" gap="2">
              {/* Status filter row */}
              <Flex gap="2" wrap="wrap" align="center">
                <Text size="1" className="text-gray-400 dark:text-gray-500 w-10 flex-shrink-0">
                  {t("settings.asrModels.filters.status")}
                </Text>
                {(["all", "downloaded", "favorites", "recommended"] as const).map((value) => (
                  <Badge
                    key={value}
                    size="2"
                    variant={statusFilter === value ? "solid" : "outline"}
                    color={statusFilter === value ? "blue" : "gray"}
                    style={{ cursor: "pointer" }}
                    onClick={() => setStatusFilter(value)}
                  >
                    {t(`settings.asrModels.filters.${value}`)}
                  </Badge>
                ))}
              </Flex>

              {/* Mode filter row */}
              <Flex gap="2" wrap="wrap" align="center">
                <Text size="1" className="text-gray-400 dark:text-gray-500 w-10 flex-shrink-0">
                  {t("settings.asrModels.filters.mode")}
                </Text>
                {(["streaming", "offline", "punctuation"] as const).map((mode) => (
                  <Badge
                    key={mode}
                    size="2"
                    variant={modeFilter.has(mode) ? "solid" : "outline"}
                    color={modeFilter.has(mode) ? "blue" : "gray"}
                    style={{ cursor: "pointer" }}
                    onClick={() => setModeFilter((s) => toggleSetValue(s, mode))}
                  >
                    {t(`settings.asrModels.groups.${mode}`)}
                  </Badge>
                ))}
              </Flex>

              {/* Language filter row */}
              <Flex gap="2" wrap="wrap" align="center">
                <Text size="1" className="text-gray-400 dark:text-gray-500 w-10 flex-shrink-0">
                  {t("settings.asrModels.filters.language")}
                </Text>
                {allLanguageKeys
                  .slice()
                  .sort((a, b) => orderLanguage(a) - orderLanguage(b))
                  .map((k) => (
                    <Badge
                      key={k}
                      size="2"
                      variant={languageFilter.has(k) ? "solid" : "outline"}
                      color={languageFilter.has(k) ? "blue" : "gray"}
                      style={{ cursor: "pointer" }}
                      onClick={() => setLanguageFilter((s) => toggleSetValue(s, k))}
                    >
                      {t(`settings.asrModels.languages.${k}`)}
                    </Badge>
                  ))}
              </Flex>

              {/* Type filter row */}
              <Flex gap="2" wrap="wrap" align="center">
                <Text size="1" className="text-gray-400 dark:text-gray-500 w-10 flex-shrink-0">
                  {t("settings.asrModels.filters.type")}
                </Text>
                {typeKeys
                  .slice()
                  .sort((a, b) => orderType(a) - orderType(b))
                  .map((k) => (
                    <Badge
                      key={k}
                      size="2"
                      variant={typeFilter.has(k) ? "solid" : "outline"}
                      color={typeFilter.has(k) ? "blue" : "gray"}
                      style={{ cursor: "pointer" }}
                      onClick={() => setTypeFilter((s) => toggleSetValue(s, k))}
                    >
                      {t(`settings.asrModels.typeChips.${k}`).replace(/^Sherpa\s+/i, "")}
                    </Badge>
                  ))}
                <Tooltip content={t("settings.asrModels.reset")}>
                  <IconButton
                    size="1"
                    variant="ghost"
                    color="gray"
                    onClick={resetLibraryFilters}
                    disabled={busy}
                  >
                    <IconRefresh className="w-3 h-3" />
                  </IconButton>
                </Tooltip>
              </Flex>
            </Flex>

            <Separator size="4" />

            <Box className="space-y-5">
              {groupsByMode.map(([mode, list]) => {
                let textClass = "text-gray-700 dark:text-gray-300";
                let badgeColor: "gray" | "blue" | "amber" = "gray";

                if (mode === "streaming") {
                  textClass = "text-blue-600 dark:text-blue-400";
                  badgeColor = "blue";
                } else if (mode === "offline") {
                  textClass = "text-stone-600 dark:text-stone-300";
                  badgeColor = "gray";
                } else if (mode === "punctuation") {
                  textClass = "text-amber-600 dark:text-amber-400";
                  badgeColor = "amber";
                }

                return (
                  <Box key={mode} className="space-y-2">
                    <Flex justify="between" align="center">
                      <Text size="2" weight="medium" className={textClass}>
                        {t(`settings.asrModels.groups.${mode}`)}
                      </Text>
                      <Badge variant="soft" color={badgeColor}>
                        {list.length}
                      </Badge>
                    </Flex>
                    <Box className="space-y-2">{list.map(renderModelRow)}</Box>
                  </Box>
                );
              })}
            </Box>
          </Flex>
        </SettingsGroup>
      </Box>

      {/* Remove Confirmation Dialog */}
      <AlertDialog.Root open={removeConfirmOpen} onOpenChange={setRemoveConfirmOpen}>
        <AlertDialog.Content maxWidth="450px">
          <AlertDialog.Title>{t("settings.asrModels.install.remove")}</AlertDialog.Title>
          <AlertDialog.Description size="2">
            {t("settings.asrModels.install.removeConfirm")}
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">
                {t("common.cancel")}
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button variant="solid" color="red" onClick={confirmRemoveModel}>
                {t("common.delete")}
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </Flex>
  );
};
