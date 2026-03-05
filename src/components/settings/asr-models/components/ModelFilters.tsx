// ModelFilters - Filter tags for ASR models

import { Badge, Flex, IconButton, Text, Tooltip } from "@radix-ui/themes";
import { IconRefresh } from "@tabler/icons-react";
import { TFunction } from "i18next";
import React from "react";
import { ALL_LANGUAGE_KEYS, TYPE_KEYS } from "../constants";
import type { LanguageKey, ModeKey, StatusFilter, TypeKey } from "../types";
import { orderLanguage, orderType, toggleSetValue } from "../utils";

interface ModelFiltersProps {
  t: TFunction;
  statusFilter: StatusFilter;
  setStatusFilter: (value: StatusFilter) => void;
  modeFilter: Set<ModeKey>;
  setModeFilter: React.Dispatch<React.SetStateAction<Set<ModeKey>>>;
  languageFilter: Set<LanguageKey>;
  setLanguageFilter: React.Dispatch<React.SetStateAction<Set<LanguageKey>>>;
  typeFilter: Set<TypeKey>;
  setTypeFilter: React.Dispatch<React.SetStateAction<Set<TypeKey>>>;
  onReset: () => void;
  disabled?: boolean;
}

export const ModelFilters: React.FC<ModelFiltersProps> = ({
  t,
  statusFilter,
  setStatusFilter,
  modeFilter,
  setModeFilter,
  languageFilter,
  setLanguageFilter,
  typeFilter,
  setTypeFilter,
  onReset,
  disabled = false,
}) => {
  return (
    <Flex direction="column" gap="2">
      {/* Status filter row */}
      <Flex gap="2" wrap="wrap" align="center">
        <Text
          size="1"
          className="text-gray-400 dark:text-gray-500 w-10 flex-shrink-0"
        >
          {t("settings.asrModels.filters.status")}
        </Text>
        {(["all", "downloaded", "favorites", "recommended"] as const).map(
          (value) => (
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
          ),
        )}
      </Flex>

      {/* Mode filter row */}
      <Flex gap="2" wrap="wrap" align="center">
        <Text
          size="1"
          className="text-gray-400 dark:text-gray-500 w-10 flex-shrink-0"
        >
          {t("settings.asrModels.filters.mode")}
        </Text>
        {(["asr", "punctuation"] as const).map((mode) => (
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
        <Text
          size="1"
          className="text-gray-400 dark:text-gray-500 w-10 flex-shrink-0"
        >
          {t("settings.asrModels.filters.language")}
        </Text>
        {ALL_LANGUAGE_KEYS.slice()
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
        <Text
          size="1"
          className="text-gray-400 dark:text-gray-500 w-10 flex-shrink-0"
        >
          {t("settings.asrModels.filters.type")}
        </Text>
        {TYPE_KEYS.slice()
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
              {t(`settings.asrModels.typeChips.${k}`).replace(
                /^Sherpa\s+/i,
                "",
              )}
            </Badge>
          ))}
        <Tooltip content={t("settings.asrModels.reset")}>
          <IconButton
            size="1"
            variant="ghost"
            color="gray"
            onClick={onReset}
            disabled={disabled}
          >
            <IconRefresh className="w-3 h-3" />
          </IconButton>
        </Tooltip>
      </Flex>
    </Flex>
  );
};
