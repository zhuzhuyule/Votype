// ASR Models Settings - Main component (refactored)
// This component orchestrates the ASR models settings page using extracted components and hooks

import {
  Badge,
  Box,
  Flex,
  Heading,
  Separator,
  Switch,
  Text,
  TextField,
} from "@radix-ui/themes";
import { IconSearch } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../../hooks/useSettings";
import { Dropdown } from "../../ui/Dropdown";
import { SettingsGroup } from "../../ui/SettingsGroup";
import {
  AddModelDialog,
  ModelFilters,
  ModelGroup,
  RemoveModelDialog,
} from "./components";
import { useAsrModels } from "./hooks/useAsrModels";
import type { AsrModelsSettingsProps } from "./types";

export const AsrModelsSettings: React.FC<AsrModelsSettingsProps> = ({
  className,
  hideHeader = false,
}) => {
  const { t } = useTranslation();
  const { settings, updateSetting } = useSettings();

  const {
    // Data
    models,
    groupsByMode,
    favoriteSet,
    punctuationModelOptions,
    selectedPunctuationModelId,

    // UI State
    busy,
    error,
    query,
    statusFilter,
    modeFilter,
    languageFilter,
    typeFilter,
    autoDownloadingPunctuation,

    // Dialog State
    isAddDialogOpen,
    editMode,
    url,
    addName,
    addTags,
    customTagInput,
    removeConfirmOpen,

    // Setters
    setQuery,
    setStatusFilter,
    setModeFilter,
    setLanguageFilter,
    setTypeFilter,
    setIsAddDialogOpen,
    setUrl,
    setAddName,
    setCustomTagInput,

    // Actions
    resetFilters,
    openAddDialog,
    openRemoveConfirm,
    confirmRemoveModel,
    addFromUrl,
    toggleAddTag,
    addCustomTag,
    toggleFavorite,
    deleteModelFiles,
    downloadModel,
    openEditDialog,
    setRemoveConfirmOpen,
  } = useAsrModels();

  return (
    <Flex
      direction="column"
      className={`w-full mx-auto space-y-8 ${className || "max-w-5xl"}`}
    >
      {!hideHeader && (
        <Box mb="4" px="1">
          <Heading
            size="4"
            weight="bold"
            highContrast
            style={{ color: "var(--gray-12)" }}
          >
            {t("settings.asrModels.title")}
          </Heading>
          <Text size="2" color="gray" mt="1" style={{ display: "block" }}>
            {t("settings.asrModels.description")}
          </Text>
        </Box>
      )}

      <Box className="space-y-8">
        {/* Auto-downloading punctuation model notice */}
        {autoDownloadingPunctuation && (
          <Box className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
            <Text size="2" color="blue">
              {t(
                "settings.asrModels.autoDownloadingPunctuation",
                "正在自动下载标点模型...",
              )}
            </Text>
          </Box>
        )}

        {/* Quick Settings Group */}
        <SettingsGroup title={t("settings.asrModels.quickSettings.title")}>
          <Flex direction="column" gap="4" py="2">
            {/* Punctuation toggle */}
            <Flex justify="between" align="center" gap="3" wrap="wrap">
              <Box>
                <Text size="2" weight="medium">
                  {t("settings.asrModels.pipeline.punctuation")}
                </Text>
                <Text size="1" color="gray" style={{ display: "block" }}>
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

            {/* Punctuation model selector */}
            {settings?.punctuation_enabled && (
              <Flex justify="between" align="center" gap="3" wrap="wrap">
                <Box>
                  <Text size="2" weight="medium">
                    {t("settings.asrModels.pipeline.punctuationModel")}
                  </Text>
                  <Text size="1" color="gray" style={{ display: "block" }}>
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
            )}
          </Flex>
        </SettingsGroup>

        {/* Library Group */}
        <SettingsGroup
          title={t("settings.asrModels.library.title")}
          description={t("settings.asrModels.library.description")}
          actions={
            <Badge variant="soft" color="gray">
              {t("settings.asrModels.library.count", { count: models.length })}
            </Badge>
          }
        >
          <Flex direction="column" gap="4" py="2">
            {/* Search and Add button */}
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

              <AddModelDialog
                t={t}
                isOpen={isAddDialogOpen}
                onOpenChange={setIsAddDialogOpen}
                editMode={editMode}
                url={url}
                setUrl={setUrl}
                addName={addName}
                setAddName={setAddName}
                addTags={addTags}
                customTagInput={customTagInput}
                setCustomTagInput={setCustomTagInput}
                onToggleTag={toggleAddTag}
                onAddCustomTag={addCustomTag}
                onOpenAddDialog={openAddDialog}
                onSubmit={addFromUrl}
                busy={busy}
                error={error}
              />
            </Flex>

            {/* Error display */}
            {!isAddDialogOpen && error && (
              <Text size="2" color="red">
                {error}
              </Text>
            )}

            {/* Filters */}
            <ModelFilters
              t={t}
              statusFilter={statusFilter}
              setStatusFilter={setStatusFilter}
              modeFilter={modeFilter}
              setModeFilter={setModeFilter}
              languageFilter={languageFilter}
              setLanguageFilter={setLanguageFilter}
              typeFilter={typeFilter}
              setTypeFilter={setTypeFilter}
              onReset={resetFilters}
              disabled={busy}
            />

            <Separator size="4" />

            {/* Model groups */}
            <Box className="space-y-5">
              {groupsByMode.map(([mode, list]) => (
                <ModelGroup
                  key={mode}
                  mode={mode}
                  models={list}
                  t={t}
                  favoriteSet={favoriteSet}
                  busy={busy}
                  onToggleFavorite={toggleFavorite}
                  onDownload={downloadModel}
                  onDeleteFiles={deleteModelFiles}
                  onEdit={openEditDialog}
                  onRemove={openRemoveConfirm}
                />
              ))}
            </Box>
          </Flex>
        </SettingsGroup>
      </Box>

      {/* Remove Confirmation Dialog */}
      <RemoveModelDialog
        t={t}
        isOpen={removeConfirmOpen}
        onOpenChange={setRemoveConfirmOpen}
        onConfirm={confirmRemoveModel}
      />
    </Flex>
  );
};
