import {
  Box,
  Flex,
  Popover,
  ScrollArea,
  Text,
  TextField,
} from "@radix-ui/themes";
import { IconChevronDown, IconSearch } from "@tabler/icons-react";
import React, { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ModelInfo } from "../../../lib/types";
import { getTranslatedModelName } from "../../../lib/utils/modelTranslation";

// No recommended models for secondary without Sherpa
export const RECOMMENDED_MODEL_IDS = new Set<string>([]);

type LanguageKey =
  | "zh"
  | "yue"
  | "en"
  | "ja"
  | "ko"
  | "de"
  | "es"
  | "fr"
  | "ru";

const parseLanguageKeys = (modelId: string): LanguageKey[] => {
  const id = modelId.toLowerCase();
  const tokenSet = new Set<LanguageKey>();

  const re = /(^|[-_])(zh|yue|ct|cantonese|en|ja|ko|de|es|fr|ru)(?=([-_]|$))/g;
  for (const match of id.matchAll(re)) {
    const tok = match[2];
    if (tok === "ct" || tok === "cantonese") tokenSet.add("yue");
    else tokenSet.add(tok as LanguageKey);
  }

  return Array.from(tokenSet);
};

type Option = {
  value: string | null;
  title: string;
  description: string;
  isRecommended?: boolean;
  tag?: string;
  meta?: string;
};

const triggerClasses =
  "custom-select-trigger flex items-center justify-between min-h-[40px] w-fit min-w-[16rem] max-w-[28rem] rounded-lg bg-background border border-mid-gray/20 px-3 py-2 text-sm font-medium text-text transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-logo-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background hover:border-logo-primary/50";

export const SecondaryModelDropdown: React.FC<{
  models: ModelInfo[];
  selectedModelId: string | null | undefined;
  onSelect: (modelId: string | null) => void;
  disabled?: boolean;
}> = React.memo(({ models, selectedModelId, onSelect, disabled = false }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [filterText, setFilterText] = useState("");

  const options = useMemo(() => {
    const getFeatureTags = (m: ModelInfo): string[] => {
      const tags: string[] = [];
      const id = m.id.toLowerCase();

      if (id.includes("int8")) tags.push("INT8");
      if (id.includes("trilingual")) tags.push("Trilingual");
      if (id.includes("bilingual")) tags.push("Bilingual");

      return tags;
    };

    const buildShortTitleFromId = (id: string): string => {
      const cleaned = id.replace(/-\d{4}-\d{2}-\d{2}(?=-|$)/g, "");

      const tokens = cleaned.split("-").filter(Boolean);
      const familyToken = tokens[0] ?? "Model";
      const family =
        familyToken === "paraformer"
          ? "Paraformer"
          : familyToken === "sensevoice"
            ? "SenseVoice"
            : familyToken === "zipformer-ctc"
              ? "Zipformer CTC"
              : familyToken === "zipformer"
                ? "Zipformer Transducer"
                : familyToken.charAt(0).toUpperCase() + familyToken.slice(1);

      const sizeToken = tokens.find((tok) =>
        ["tiny", "small", "medium", "large"].includes(tok),
      );
      const qualifierToken = tokens.find((tok) =>
        ["trilingual", "bilingual"].includes(tok),
      );

      const langs = parseLanguageKeys(id);
      const langCodes =
        langs.length > 0
          ? ` (${langs.map((k) => k.toUpperCase()).join("·")})`
          : "";

      const parts = [family];
      if (sizeToken)
        parts.push(sizeToken.charAt(0).toUpperCase() + sizeToken.slice(1));
      if (qualifierToken) {
        parts.push(
          qualifierToken.charAt(0).toUpperCase() + qualifierToken.slice(1),
        );
      }

      return `${parts.join(" ")}${langCodes}`;
    };

    const getOptionTitle = (m: ModelInfo): string => {
      const translated = getTranslatedModelName(m, t);
      const looksLikeId =
        translated === m.id ||
        translated === m.name ||
        /-\d{4}-\d{2}-\d{2}/.test(translated) ||
        translated.length > 36;
      if (!looksLikeId) return translated;
      return buildShortTitleFromId(m.id);
    };

    const out: Option[] = [
      {
        value: null,
        title: t("settings.postProcessing.fusion.secondaryModel.auto"),
        description: t(
          "settings.postProcessing.fusion.secondaryModel.autoDescription",
        ),
      },
    ];

    const candidates: typeof out = models
      .filter((m) => m.is_downloaded)
      .map((m) => {
        const featureTags = getFeatureTags(m);
        return {
          value: m.id,
          title: getOptionTitle(m),
          description: m.description || m.id,
          isRecommended: RECOMMENDED_MODEL_IDS.has(m.id),
          tag: featureTags.join(" · ") || undefined,
          meta: m.size_mb ? `${m.size_mb}MB` : undefined,
        };
      });

    out.push(...candidates);
    return out;
  }, [models, t]);

  const selected =
    options.find((o) => o.value === (selectedModelId ?? null)) ?? options[0];

  const filtered = useMemo(() => {
    const q = filterText.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => {
      if (o.value === null) return true;
      return (
        o.title.toLowerCase().includes(q) ||
        o.description.toLowerCase().includes(q) ||
        (o.value ?? "").toLowerCase().includes(q) ||
        (o.meta ?? "").toLowerCase().includes(q)
      );
    });
  }, [options, filterText]);

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (disabled) {
          setOpen(false);
          return;
        }
        setOpen(next);
        if (!next) {
          setFilterText("");
        }
      }}
    >
      <Popover.Trigger>
        <button type="button" className={triggerClasses} disabled={disabled}>
          <span className="truncate">{selected.title}</span>
          <IconChevronDown size={16} className="opacity-70" />
        </button>
      </Popover.Trigger>
      <Popover.Content
        size="2"
        style={{ minWidth: 520, padding: 0 }}
        side="bottom"
        align="start"
      >
        <Box className="p-3 border-b border-mid-gray/20">
          <TextField.Root
            placeholder={t("common.filterOptions")}
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            disabled={disabled}
          >
            <TextField.Slot>
              <IconSearch size={14} />
            </TextField.Slot>
          </TextField.Root>
        </Box>
        <ScrollArea
          type="auto"
          scrollbars="vertical"
          style={{ maxHeight: 360, padding: 0 }}
        >
          <Box className="py-2">
            {filtered.map((opt) => {
              const isActive = opt.value === (selectedModelId ?? null);
              return (
                <Box
                  key={opt.value ?? "auto"}
                  onClick={() => {
                    if (disabled) return;
                    onSelect(opt.value);
                    setOpen(false);
                  }}
                  role="button"
                  tabIndex={0}
                  className={`px-4 py-2.5 cursor-pointer hover:bg-mid-gray/5 transition-all border-l-2 ${
                    isActive
                      ? "bg-logo-primary/5 border-logo-primary"
                      : "border-transparent"
                  }`}
                >
                  <Flex justify="between" align="start" gap="3">
                    <Box className="min-w-0">
                      <Flex align="center" gap="2" mb="1" wrap="wrap">
                        <Text size="2" weight="medium" className="truncate">
                          {opt.title}
                        </Text>
                        {opt.isRecommended ? (
                          <Text
                            className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 font-medium border border-amber-100"
                            size="1"
                          >
                            {t("onboarding.recommended")}
                          </Text>
                        ) : null}
                        {opt.tag ? (
                          <Text
                            className="text-[10px] px-1.5 py-0.5 rounded-full bg-mid-gray/10 text-text/60 font-medium"
                            size="1"
                          >
                            {opt.tag}
                          </Text>
                        ) : null}
                        {opt.meta ? (
                          <Text className="text-[10px] text-text/40" size="1">
                            {opt.meta}
                          </Text>
                        ) : null}
                      </Flex>
                      <Text
                        className="text-xs text-text/50 block leading-tight"
                        size="1"
                      >
                        {opt.description}
                      </Text>
                      {opt.value ? (
                        <Text
                          className="text-[11px] text-text/35 block mt-1"
                          size="1"
                        >
                          id: {opt.value}
                        </Text>
                      ) : null}
                    </Box>
                    {isActive ? (
                      <Text
                        className="text-xs text-logo-primary font-medium shrink-0"
                        size="1"
                      >
                        ✓
                      </Text>
                    ) : null}
                  </Flex>
                </Box>
              );
            })}
          </Box>
        </ScrollArea>
      </Popover.Content>
    </Popover.Root>
  );
});
