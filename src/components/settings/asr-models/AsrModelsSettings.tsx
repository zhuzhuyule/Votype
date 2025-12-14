import {
  Badge,
  Box,
  Card,
  Flex,
  Heading,
  IconButton,
  Separator,
  Switch,
  Text,
  TextField,
  Tooltip,
} from "@radix-ui/themes";
import { invoke } from "@tauri-apps/api/core";
import {
  IconDownload,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconStar,
  IconStarFilled,
  IconTrash,
} from "@tabler/icons-react";
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

type StatusFilter = "all" | "downloaded" | "favorites";

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
  "punct-zh-en-ct-transformer-2024-04-12-int8",
  "sherpa-paraformer-zh-small-2024-03-09",
]);

const parseLanguageKeys = (model: ModelInfo): LanguageKey[] => {
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

const Chip: React.FC<{
  selected: boolean;
  onClick: () => void;
  label: string;
}> = ({ selected, onClick, label }) => {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${
        selected
          ? "bg-logo-primary text-white border-logo-primary"
          : "bg-background border-mid-gray/20 text-text/70 hover:border-logo-primary/40"
      }`}
    >
      {label}
    </button>
  );
};

export const AsrModelsSettings: React.FC = () => {
  const { t } = useTranslation();
  const { settings, updateSetting } = useSettings();

  const [models, setModels] = useState<ModelInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [url, setUrl] = useState("");
  const [query, setQuery] = useState("");

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
      label: `${getTranslatedModelName(m, t)} · ${m.size_mb}MB`,
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

  const addFromUrl = async () => {
    const value = url.trim();
    if (!value) return;

    setBusy(true);
    setError(null);
    try {
      const modelId = await invoke<string>("add_model_from_url", {
        url: value,
      });
      setUrl("");
      await refreshModels();
      await invoke("download_model", { modelId });
      await refreshModels();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
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

        {!m.is_downloaded ? (
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
        ) : (
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
      </Flex>
    );
  };

  const renderModelRow = (m: ModelInfo) => {
    const title = getTranslatedModelName(m, t);
    const description = getTranslatedModelDescription(m, t);

    const typeKey = getTypeKey(m);
    const isRecommended = RECOMMENDED_MODEL_IDS.has(m.id);
    const languages = parseLanguageKeys(m);
    const isMultilingual = languages.includes("multilingual");
    const languageBadges = isMultilingual
      ? languages
          .filter((l) => l !== "multilingual" && l !== "other")
          .sort((a, b) => orderLanguage(a) - orderLanguage(b))
      : languages.filter((l) => l !== "other");

    const size = m.size_mb;
    const sizeText = size != null ? `${size}MB` : null;
    const sizeKind = sizeBucket(size);
    const sizeColor =
      sizeKind === "small"
        ? "green"
        : sizeKind === "medium"
          ? "amber"
          : sizeKind === "large"
            ? "red"
            : "gray";

    return (
      <Card key={m.id} className="border border-mid-gray/10 bg-background/40">
        <Flex justify="between" align="start" gap="3">
          <Box className="min-w-0 flex-1">
            <Flex align="baseline" gap="2" className="min-w-0">
              <Heading as="h3" size="3" weight="medium" className="truncate">
                {title}
              </Heading>
              <Text size="1" color="gray" className="truncate opacity-40">
                {t("settings.asrModels.idLabel", { id: m.id })}
              </Text>
            </Flex>

            <Flex gap="2" wrap="wrap" mt="1">
              {isMultilingual ? (
                <Badge variant="soft" color="gray">
                  {t("settings.asrModels.groups.multilingual")}
                </Badge>
              ) : null}
              {isRecommended ? (
                <Badge variant="soft" color="amber">
                  {t("onboarding.recommended")}
                </Badge>
              ) : null}
              {sizeText ? (
                <Badge variant="soft" color={sizeColor}>
                  {sizeText}
                </Badge>
              ) : null}
              {languageBadges.map((l) => (
                <Badge key={`${m.id}:lang:${l}`} variant="soft" color="gray">
                  {t(`settings.asrModels.languages.${l}`)}
                </Badge>
              ))}
              {languageBadges.length === 0 ? (
                <Badge variant="soft" color="gray">
                  {t("settings.asrModels.languages.other")}
                </Badge>
              ) : null}
              <Badge variant="soft" color="gray">
                {t(`settings.asrModels.typeChips.${typeKey}`)}
              </Badge>
              {m.is_downloaded ? (
                <Badge variant="soft" color="green">
                  {t("settings.asrModels.status.downloaded")}
                </Badge>
              ) : (
                <Badge variant="soft" color="blue">
                  {t("settings.asrModels.status.notDownloaded")}
                </Badge>
              )}
            </Flex>

            <Text
              size="2"
              color="gray"
              className="whitespace-pre-line break-words line-clamp-2"
              mt="2"
            >
              {description}
            </Text>
          </Box>
          <Box className="flex-shrink-0 ml-auto">{renderActions(m)}</Box>
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
    <SettingsGroup
      title={t("settings.asrModels.title")}
      description={t("settings.asrModels.description")}
      framed={false}
    >
      <Box className="space-y-4">
        {/* Two boxes: quick settings + library */}
        <Card className="border border-mid-gray/10 bg-background/40">
          <Flex direction="column" gap="3">
            <Heading as="h3" size="3">
              {t("settings.asrModels.quickSettings.title")}
            </Heading>

            <Flex justify="between" align="center" gap="3" wrap="wrap">
              <Box>
                <Text size="2" weight="medium">
                  {t("settings.asrModels.pipeline.punctuation")}
                </Text>
                <Text size="1" color="gray">
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
                  <Text size="1" color="gray">
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
                <Text size="1" color="gray">
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
        </Card>

        <Card className="border border-mid-gray/10 bg-background/40">
          <Flex direction="column" gap="3">
            <Flex justify="between" align="start" gap="3" wrap="wrap">
              <Box>
                <Heading as="h3" size="3">
                  {t("settings.asrModels.library.title")}
                </Heading>
                <Text size="2" color="gray">
                  {t("settings.asrModels.library.description")}
                </Text>
              </Box>

              <Flex gap="2" align="center">
                <Tooltip content={t("settings.asrModels.reset")}>
                  <IconButton
                    size="2"
                    variant="soft"
                    onClick={resetLibraryFilters}
                    disabled={busy}
                  >
                    <IconRefresh className="w-4 h-4" />
                  </IconButton>
                </Tooltip>
                <Badge variant="soft" color="gray">
                  {t("settings.asrModels.library.count", {
                    count: models.length,
                  })}
                </Badge>
              </Flex>
            </Flex>

            <Flex gap="2" align="center" wrap="wrap">
              <Box className="flex-1 min-w-[260px]">
                <TextField.Root
                  placeholder={t("settings.asrModels.install.placeholder")}
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
              <Tooltip content={t("settings.asrModels.install.tooltip")}>
                <IconButton
                  size="2"
                  variant="soft"
                  onClick={addFromUrl}
                  disabled={busy || !url.trim()}
                >
                  <IconPlus className="w-4 h-4" />
                </IconButton>
              </Tooltip>
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
            </Flex>

            {error ? (
              <Text size="2" color="red">
                {error}
              </Text>
            ) : null}

            <Box className="space-y-2">
              {/* Status chips */}
              <Flex gap="2" align="center" wrap="wrap">
                <Text size="1" color="gray" className="min-w-[56px]">
                  {t("settings.asrModels.filters.status")}
                </Text>
                {(
                  [
                    ["all", t("settings.asrModels.filters.all")],
                    ["downloaded", t("settings.asrModels.filters.downloaded")],
                    ["favorites", t("settings.asrModels.filters.favorites")],
                  ] as const
                ).map(([value, label]) => (
                  <Chip
                    key={value}
                    selected={statusFilter === value}
                    onClick={() => setStatusFilter(value)}
                    label={label}
                  />
                ))}
              </Flex>

              {/* Mode chips */}
              <Flex gap="2" align="center" wrap="wrap">
                <Text size="1" color="gray" className="min-w-[56px]">
                  {t("settings.asrModels.filters.mode")}
                </Text>
                {(
                  [
                    ["streaming", t("settings.asrModels.groups.streaming")],
                    ["offline", t("settings.asrModels.groups.offline")],
                    ["punctuation", t("settings.asrModels.groups.punctuation")],
                  ] as const
                ).map(([value, label]) => (
                  <Chip
                    key={value}
                    selected={modeFilter.has(value)}
                    onClick={() =>
                      setModeFilter((s) => toggleSetValue(s, value))
                    }
                    label={label}
                  />
                ))}
              </Flex>

              {/* Language chips */}
              <Flex gap="2" align="center" wrap="wrap">
                <Text size="1" color="gray" className="min-w-[56px]">
                  {t("settings.asrModels.filters.language")}
                </Text>
                {allLanguageKeys
                  .slice()
                  .sort((a, b) => orderLanguage(a) - orderLanguage(b))
                  .map((k) => (
                    <Chip
                      key={k}
                      selected={languageFilter.has(k)}
                      onClick={() =>
                        setLanguageFilter((s) => toggleSetValue(s, k))
                      }
                      label={t(`settings.asrModels.languages.${k}`)}
                    />
                  ))}
              </Flex>

              {/* Type chips */}
              <Flex gap="2" align="center" wrap="wrap">
                <Text size="1" color="gray" className="min-w-[56px]">
                  {t("settings.asrModels.filters.type")}
                </Text>
                {typeKeys
                  .slice()
                  .sort((a, b) => orderType(a) - orderType(b))
                  .map((k) => (
                    <Chip
                      key={k}
                      selected={typeFilter.has(k)}
                      onClick={() => setTypeFilter((s) => toggleSetValue(s, k))}
                      label={t(`settings.asrModels.typeChips.${k}`)}
                    />
                  ))}
              </Flex>
            </Box>

            <Separator size="4" />

            <Box className="space-y-5">
              {groupsByMode.map(([mode, list]) => (
                <Box key={mode} className="space-y-2">
                  <Flex justify="between" align="center">
                    <Text size="2" weight="medium" color="gray">
                      {t(`settings.asrModels.groups.${mode}`)}
                    </Text>
                    <Badge variant="soft" color="gray">
                      {list.length}
                    </Badge>
                  </Flex>
                  <Box className="space-y-2">{list.map(renderModelRow)}</Box>
                </Box>
              ))}
            </Box>
          </Flex>
        </Card>
      </Box>
    </SettingsGroup>
  );
};
