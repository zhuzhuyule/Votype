// VocabularySettings - Root-level vocabulary management page
// Combines custom words (hot words) and vocabulary corrections

import {
  Badge,
  Button,
  Checkbox,
  Dialog,
  DropdownMenu,
  Flex,
  IconButton,
  SegmentedControl,
  Table,
  Text,
  TextField,
  Tooltip,
} from "@radix-ui/themes";
import {
  IconAbc,
  IconApps,
  IconDownload,
  IconLetterCase,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconUpload,
  IconWorld,
} from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../hooks/useSettings";
import { Card } from "../ui/Card";

interface VocabularyCorrection {
  id: number;
  original_text: string;
  corrected_text: string;
  app_name: string | null;
  correction_count: number;
  first_seen_at: number;
  last_seen_at: number;
  is_global: boolean;
  target_apps?: string; // JSON string
}

// Scope Editor Component
const VocabularyScopeEditor: React.FC<{
  correction: VocabularyCorrection;
  onUpdate: (
    id: number,
    isGlobal: boolean,
    targetApps: string | null,
  ) => Promise<void>;
  knownApps: string[];
}> = ({ correction, onUpdate, knownApps }) => {
  const { t } = useTranslation();
  // Dialog open state for Custom selection
  const [dialogOpen, setDialogOpen] = useState(false);

  // Parse target_apps JSON if it exists
  const [selectedApps, setSelectedApps] = useState<string[]>(() => {
    if (correction.target_apps) {
      try {
        return JSON.parse(correction.target_apps);
      } catch {
        return [];
      }
    }
    return correction.app_name ? [correction.app_name] : [];
  });

  const handleGlobalClick = async () => {
    await onUpdate(correction.id, true, null);
  };

  const handleSourceClick = async () => {
    await onUpdate(correction.id, false, null);
  };

  const handleCustomClick = () => {
    // Determine initial state for custom dialog
    // If already custom, keep current selection
    // If not, default to current app or none
    if (!correction.target_apps) {
      if (correction.app_name) {
        setSelectedApps([correction.app_name]);
      } else {
        setSelectedApps([]);
      }
    }
    setDialogOpen(true);
  };

  const handleCustomSave = async () => {
    await onUpdate(correction.id, false, JSON.stringify(selectedApps));
    setDialogOpen(false);
  };

  const getLabel = () => {
    if (correction.is_global) return t("settings.vocabulary.scope.global");
    if (correction.target_apps) {
      try {
        const apps = JSON.parse(correction.target_apps);
        if (apps.length === 0) return t("settings.vocabulary.scope.none");
        if (apps.length === 1) return apps[0];
        return t("settings.vocabulary.scope.multiple", { count: apps.length });
      } catch {
        return t("settings.vocabulary.scope.custom");
      }
    }
    return correction.app_name
      ? t("settings.vocabulary.scope.source", { app: correction.app_name })
      : t("settings.vocabulary.corrections.allApps");
  };

  const Icon = correction.is_global ? IconWorld : IconApps;

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger>
          <Button variant="ghost" size="1" className="cursor-pointer">
            <Flex gap="1" align="center">
              <Icon size={12} />
              <Text size="1">{getLabel()}</Text>
            </Flex>
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Content>
          <DropdownMenu.Item onClick={handleGlobalClick}>
            {t("settings.vocabulary.scope.global")}
          </DropdownMenu.Item>
          <DropdownMenu.Item
            onClick={handleSourceClick}
            disabled={!correction.app_name}
          >
            {correction.app_name
              ? t("settings.vocabulary.scope.source", {
                  app: correction.app_name,
                })
              : t("settings.vocabulary.corrections.sourceUnavailable")}
          </DropdownMenu.Item>
          <DropdownMenu.Item onClick={handleCustomClick}>
            {t("settings.vocabulary.scope.custom")}...
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Root>

      <Dialog.Root open={dialogOpen} onOpenChange={setDialogOpen}>
        <Dialog.Content style={{ maxWidth: 450 }}>
          <Dialog.Title>
            {t("settings.vocabulary.scope.editTitle")}
          </Dialog.Title>
          <Dialog.Description size="2" mb="4">
            {t("settings.vocabulary.scope.editDescription", {
              original: correction.original_text,
              corrected: correction.corrected_text,
            })}
          </Dialog.Description>

          <Card className="p-2 border border-(--gray-a4) bg-(--gray-a2) max-h-[300px] overflow-y-auto">
            <Flex direction="column" gap="2">
              {knownApps.map((app) => (
                <Text as="label" size="2" key={app}>
                  <Flex gap="2">
                    <Checkbox
                      checked={selectedApps.includes(app)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setSelectedApps([...selectedApps, app]);
                        } else {
                          setSelectedApps(
                            selectedApps.filter((a: string) => a !== app),
                          );
                        }
                      }}
                    />
                    {app}
                  </Flex>
                </Text>
              ))}
            </Flex>
          </Card>

          <Flex gap="3" mt="4" justify="end">
            <Dialog.Close>
              <Button variant="soft" color="gray">
                {t("common.cancel")}
              </Button>
            </Dialog.Close>
            <Button onClick={handleCustomSave}>{t("common.save")}</Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    </>
  );
};

export const VocabularySettings: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, updateSetting, isUpdating } = useSettings();
  const [newWord, setNewWord] = useState("");
  const customWords: string[] = getSetting("custom_words") || [];

  // Try to derive known apps from various sources (profiles + history if possible)
  // For now we use profiles as a base list of "known" apps
  const appProfiles: any[] = getSetting("app_profiles") || [];

  // Corrections state
  const [corrections, setCorrections] = useState<VocabularyCorrection[]>([]);
  const [activeTab, setActiveTab] = useState("corrections"); // Default to corrections
  const [loadingCorrections, setLoadingCorrections] = useState(true);

  // Aggregate all known apps from profiles and existing corrections
  const knownApps = React.useMemo(() => {
    const apps = new Set<string>();

    // 1. Add apps from profiles
    appProfiles.forEach((p) => {
      if (p.name) apps.add(p.name);
    });

    // 2. Add apps from existing corrections
    corrections.forEach((c) => {
      if (c.app_name) apps.add(c.app_name);
      if (c.target_apps) {
        try {
          const targets = JSON.parse(c.target_apps);
          if (Array.isArray(targets)) {
            targets.forEach((t: string) => apps.add(t));
          }
        } catch {}
      }
    });

    return Array.from(apps).sort();
  }, [appProfiles, corrections]);

  // Load corrections
  const loadCorrections = useCallback(async () => {
    setLoadingCorrections(true);
    try {
      const result = await invoke<VocabularyCorrection[]>(
        "get_vocabulary_corrections",
        { appName: null },
      );
      setCorrections(result);
    } catch (e) {
      console.error("[VocabularySettings] Failed to load corrections:", e);
    } finally {
      setLoadingCorrections(false);
    }
  }, []);

  useEffect(() => {
    loadCorrections();
  }, [loadCorrections]);

  // Hot words handlers
  const handleAddWord = () => {
    const trimmedWord = newWord.trim();
    const sanitizedWord = trimmedWord.replace(/[<>"'&]/g, "");
    if (
      sanitizedWord &&
      !sanitizedWord.includes(" ") &&
      sanitizedWord.length <= 50 &&
      !customWords.includes(sanitizedWord)
    ) {
      updateSetting("custom_words", [...customWords, sanitizedWord]);
      setNewWord("");
    }
  };

  const handleRemoveWord = (wordToRemove: string) => {
    updateSetting(
      "custom_words",
      customWords.filter((word) => word !== wordToRemove),
    );
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddWord();
    }
  };

  // Corrections handlers
  const handleDeleteCorrection = useCallback(async (id: number) => {
    try {
      await invoke("delete_vocabulary_correction", { id });
      setCorrections((prev) => prev.filter((c) => c.id !== id));
    } catch (e) {
      console.error("[VocabularySettings] Delete failed:", e);
    }
  }, []);

  const handleUpdateScope = useCallback(
    async (id: number, isGlobal: boolean, targetApps: string | null) => {
      try {
        await invoke("update_vocabulary_correction_scope", {
          id,
          isGlobal,
          targetApps,
        });
        setCorrections((prev) =>
          prev.map((c) =>
            c.id === id
              ? {
                  ...c,
                  is_global: isGlobal,
                  target_apps: targetApps || undefined,
                }
              : c,
          ),
        );
      } catch (e) {
        console.error("[VocabularySettings] Update scope failed:", e);
      }
    },
    [],
  );

  // Export/Import handlers
  const handleExportHotWords = () => {
    const data = JSON.stringify(customWords, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "hot_words.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportHotWords = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const imported = JSON.parse(text);
        if (Array.isArray(imported)) {
          const validWords = imported.filter(
            (w) =>
              typeof w === "string" &&
              w.trim() &&
              !w.includes(" ") &&
              w.length <= 50,
          );
          const merged = [...new Set([...customWords, ...validWords])];
          updateSetting("custom_words", merged);
        }
      } catch (err) {
        console.error("[VocabularySettings] Import failed:", err);
      }
    };
    input.click();
  };

  const handleExportCorrections = () => {
    const data = JSON.stringify(corrections, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "vocabulary_corrections.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatRelativeTime = (timestamp: number) => {
    const now = Date.now() / 1000;
    const diff = now - timestamp;
    if (diff < 60) return t("common.time.justNow");
    if (diff < 3600)
      return t("common.time.minutesAgo", { count: Math.floor(diff / 60) });
    if (diff < 86400)
      return t("common.time.hoursAgo", { count: Math.floor(diff / 3600) });
    return t("common.time.daysAgo", { count: Math.floor(diff / 86400) });
  };

  return (
    <Card className="max-w-5xl w-full mx-auto p-0 overflow-hidden flex flex-col h-[calc(100vh-120px)]">
      <Flex
        justify="center"
        className="border-b border-(--gray-a4) bg-(--gray-a2) py-3"
      >
        <SegmentedControl.Root
          value={activeTab}
          onValueChange={setActiveTab}
          size="2"
        >
          <SegmentedControl.Item value="corrections">
            <Flex gap="2" align="center" px="6">
              <IconLetterCase size={16} />
              {t("settings.vocabulary.corrections.title")}
            </Flex>
          </SegmentedControl.Item>
          <SegmentedControl.Item value="hotwords">
            <Flex gap="2" align="center" px="6">
              <IconAbc size={16} />
              {t("settings.vocabulary.hotWords.title")}
            </Flex>
          </SegmentedControl.Item>
        </SegmentedControl.Root>
      </Flex>

      <div className="flex-1 overflow-y-auto p-6">
        {/* Corrections Tab Content (Now First) */}
        {activeTab === "corrections" && (
          <Flex direction="column" gap="4" className="animate-fade-in-up">
            <Flex justify="between" align="center">
              <Text size="2" color="gray">
                {t("settings.vocabulary.corrections.description")}
              </Text>
              <Flex gap="2">
                <Button variant="soft" color="gray" onClick={loadCorrections}>
                  <IconRefresh size={14} />
                  {t("common.refresh")}
                </Button>
                <Button
                  variant="soft"
                  onClick={handleExportCorrections}
                  disabled={corrections.length === 0}
                >
                  <IconDownload size={14} />
                  {t("settings.vocabulary.export")}
                </Button>
              </Flex>
            </Flex>

            {/* Corrections table */}
            {loadingCorrections ? (
              <Text size="2" color="gray" className="py-8 text-center">
                {t("common.loading")}
              </Text>
            ) : corrections.length > 0 ? (
              <Table.Root variant="surface">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeaderCell>
                      {t("settings.vocabulary.corrections.correction")}
                    </Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell>
                      {t("settings.vocabulary.corrections.source")}
                    </Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell width="60px" align="center">
                      {t("settings.vocabulary.corrections.count")}
                    </Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell width="120px" align="center">
                      {t("settings.vocabulary.corrections.scope")}
                    </Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell width="60px" align="right">
                      {t("settings.vocabulary.actions")}
                    </Table.ColumnHeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {corrections.map((c) => (
                    <Table.Row key={c.id}>
                      <Table.Cell>
                        <Flex align="center" gap="2">
                          <Text
                            size="2"
                            className="font-mono text-red-500 line-through"
                          >
                            {c.original_text}
                          </Text>
                          <Text size="2" color="gray">
                            →
                          </Text>
                          <Text size="2" className="font-mono text-green-500">
                            {c.corrected_text}
                          </Text>
                        </Flex>
                      </Table.Cell>
                      <Table.Cell>
                        <Tooltip content={formatRelativeTime(c.last_seen_at)}>
                          <Text size="1" color="gray">
                            {c.app_name ||
                              t("settings.vocabulary.corrections.allApps")}
                          </Text>
                        </Tooltip>
                      </Table.Cell>
                      <Table.Cell align="center">
                        <Badge size="1" color="gray">
                          {c.correction_count}
                        </Badge>
                      </Table.Cell>
                      <Table.Cell align="center">
                        <VocabularyScopeEditor
                          correction={c}
                          onUpdate={handleUpdateScope}
                          knownApps={knownApps}
                        />
                      </Table.Cell>
                      <Table.Cell align="right">
                        <IconButton
                          variant="ghost"
                          size="1"
                          color="red"
                          onClick={() => handleDeleteCorrection(c.id)}
                        >
                          <IconTrash size={14} />
                        </IconButton>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            ) : (
              <Text size="2" color="gray" className="py-8 text-center">
                {t("settings.vocabulary.corrections.empty")}
              </Text>
            )}
          </Flex>
        )}

        {/* Hot Words Tab Content */}
        {activeTab === "hotwords" && (
          <Flex direction="column" gap="4" className="animate-fade-in-up">
            <Text size="2" color="gray">
              {t("settings.vocabulary.hotWords.description")}
            </Text>

            {/* Add word + Export/Import */}
            <Flex gap="2" align="center" wrap="wrap">
              <TextField.Root
                value={newWord}
                onChange={(e) => setNewWord(e.target.value)}
                onKeyDown={handleKeyPress}
                placeholder={t("settings.vocabulary.hotWords.placeholder")}
                disabled={isUpdating("custom_words")}
                className="flex-1 min-w-[200px]"
              />
              <Button
                onClick={handleAddWord}
                disabled={
                  !newWord.trim() ||
                  newWord.includes(" ") ||
                  newWord.trim().length > 50 ||
                  isUpdating("custom_words")
                }
              >
                <IconPlus size={14} />
                {t("common.add")}
              </Button>
              <Button variant="soft" onClick={handleImportHotWords}>
                <IconUpload size={14} />
                {t("settings.vocabulary.import")}
              </Button>
              <Button
                variant="soft"
                onClick={handleExportHotWords}
                disabled={customWords.length === 0}
              >
                <IconDownload size={14} />
                {t("settings.vocabulary.export")}
              </Button>
            </Flex>

            {/* Hot words table */}
            {customWords.length > 0 ? (
              <Table.Root variant="surface">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeaderCell>
                      {t("settings.vocabulary.hotWords.word")}
                    </Table.ColumnHeaderCell>
                    <Table.ColumnHeaderCell width="80px" align="right">
                      {t("settings.vocabulary.actions")}
                    </Table.ColumnHeaderCell>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {customWords.map((word) => (
                    <Table.Row key={word}>
                      <Table.Cell>
                        <Text size="2" className="font-mono">
                          {word}
                        </Text>
                      </Table.Cell>
                      <Table.Cell align="right">
                        <IconButton
                          variant="ghost"
                          size="1"
                          color="red"
                          onClick={() => handleRemoveWord(word)}
                          disabled={isUpdating("custom_words")}
                        >
                          <IconTrash size={14} />
                        </IconButton>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            ) : (
              <Text size="2" color="gray" className="py-8 text-center">
                {t("settings.vocabulary.hotWords.empty")}
              </Text>
            )}
          </Flex>
        )}
      </div>
    </Card>
  );
};
