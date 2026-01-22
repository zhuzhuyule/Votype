// VocabularySettings - Root-level vocabulary management page
// Combines custom words (hot words) and vocabulary corrections

import {
  Badge,
  Button,
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

// Scope Editor Component with Inline Dropdown Checkboxes
// Special value for "Other" (apps not in the known list)
const SCOPE_OTHER = "__OTHER__";

const VocabularyScopeEditor: React.FC<{
  correction: VocabularyCorrection;
  onUpdate: (
    id: number,
    isGlobal: boolean,
    targetApps: string | null,
  ) => Promise<void>;
  knownApps: string[];
  appProfiles?: { name: string; rules: { id: string; pattern: string }[] }[];
}> = ({ correction, onUpdate, knownApps, appProfiles = [] }) => {
  const { t } = useTranslation();

  // Build scope options: Apps + their rules
  const scopeOptions = React.useMemo(() => {
    const options: {
      type: "app" | "rule";
      value: string;
      label: string;
      indent?: boolean;
    }[] = [];

    for (const app of knownApps) {
      options.push({ type: "app", value: app, label: app });

      // Find profile for this app and add its rules
      const profile = appProfiles.find((p) => p.name === app);
      if (profile) {
        for (const rule of profile.rules) {
          options.push({
            type: "rule",
            value: `${app}##${rule.id}`,
            label: rule.pattern,
            indent: true,
          });
        }
      }
    }

    return options;
  }, [knownApps, appProfiles]);

  // All possible scope values (for toggle-all)
  const allScopeValues = React.useMemo(() => {
    return [SCOPE_OTHER, ...scopeOptions.map((o) => o.value)];
  }, [scopeOptions]);

  // Parse target_apps JSON if it exists
  const getSelectedScopes = (): string[] => {
    if (correction.target_apps) {
      try {
        return JSON.parse(correction.target_apps);
      } catch {
        return [];
      }
    }
    // If not is_global and no target_apps, it means "source app only"
    return correction.app_name ? [correction.app_name] : [];
  };

  const selectedScopes = getSelectedScopes();

  // Check if all items are selected (for toggle-all state)
  const isAllSelected = allScopeValues.every((v) => selectedScopes.includes(v));

  // Toggle all: if all selected -> deselect all; otherwise -> select all
  const handleToggleAll = async () => {
    if (isAllSelected) {
      // Deselect all
      await onUpdate(correction.id, false, JSON.stringify([]));
    } else {
      // Select all
      await onUpdate(correction.id, false, JSON.stringify(allScopeValues));
    }
  };

  // Toggle a scope (app or rule)
  const handleScopeToggle = async (scope: string, checked: boolean) => {
    let newScopes: string[];
    if (checked) {
      // Add the new scope (no mutual exclusion - parent and child can coexist)
      newScopes = [...selectedScopes, scope];
    } else {
      newScopes = selectedScopes.filter((s) => s !== scope);
    }
    // If scopes become empty, keep as empty array (none)
    await onUpdate(correction.id, false, JSON.stringify(newScopes));
  };

  const getLabel = () => {
    if (isAllSelected) return t("settings.vocabulary.scope.global");
    if (selectedScopes.length === 0) {
      // Legacy behavior: empty target_apps with app_name means source app only
      if (correction.app_name && !correction.target_apps) {
        return t("settings.vocabulary.scope.source", {
          app: correction.app_name,
        });
      }
      return t("settings.vocabulary.scope.none");
    }
    if (selectedScopes.length === 1) {
      const scope = selectedScopes[0];
      if (scope === SCOPE_OTHER) {
        return t("settings.vocabulary.scope.other");
      }
      // If it's a rule (contains ##), show nicer format
      if (scope.includes("##")) {
        const [app, ruleId] = scope.split("##");
        const profile = appProfiles.find((p) => p.name === app);
        const rule = profile?.rules.find((r) => r.id === ruleId);
        return rule ? `${app} - ${rule.pattern}` : scope;
      }
      return scope;
    }
    return t("settings.vocabulary.scope.multiple", {
      count: selectedScopes.length,
    });
  };

  const Icon = isAllSelected ? IconWorld : IconApps;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        <Button variant="ghost" size="1" className="cursor-pointer">
          <Flex gap="1" align="center">
            <Icon size={12} />
            <Text size="1">{getLabel()}</Text>
          </Flex>
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content
        style={{ maxHeight: 300, minWidth: 220, overflowY: "auto" }}
      >
        {/* Toggle All Button */}
        <DropdownMenu.Item
          onSelect={(e) => {
            e.preventDefault();
            handleToggleAll();
          }}
        >
          <Text weight="medium" color={isAllSelected ? "blue" : undefined}>
            {isAllSelected
              ? t("settings.vocabulary.scope.deselectAll")
              : t("settings.vocabulary.scope.selectAll")}
          </Text>
        </DropdownMenu.Item>

        <DropdownMenu.Separator />

        {/* "Other" option - for apps not in the known list */}
        <DropdownMenu.CheckboxItem
          checked={selectedScopes.includes(SCOPE_OTHER)}
          onCheckedChange={(checked) => handleScopeToggle(SCOPE_OTHER, checked)}
          onSelect={(e) => e.preventDefault()}
        >
          <Text size="2">{t("settings.vocabulary.scope.other")}</Text>
        </DropdownMenu.CheckboxItem>

        <DropdownMenu.Separator />

        {/* Scope Options (Apps + Rules) */}
        {scopeOptions.map((option) => (
          <DropdownMenu.CheckboxItem
            key={option.value}
            checked={selectedScopes.includes(option.value)}
            onCheckedChange={(checked) =>
              handleScopeToggle(option.value, checked)
            }
            onSelect={(e) => e.preventDefault()}
            style={{ paddingLeft: option.indent ? 24 : undefined }}
          >
            <Text
              size={option.indent ? "1" : "2"}
              color={option.indent ? "gray" : undefined}
            >
              {option.indent ? `└ ${option.label}` : option.label}
            </Text>
          </DropdownMenu.CheckboxItem>
        ))}

        {scopeOptions.length === 0 && (
          <DropdownMenu.Item disabled>
            <Text size="1" color="gray">
              {t("settings.vocabulary.scope.none")}
            </Text>
          </DropdownMenu.Item>
        )}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
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

    // 2. Add apps from existing corrections (skip rule-format strings containing ##)
    corrections.forEach((c) => {
      if (c.app_name) apps.add(c.app_name);
      if (c.target_apps) {
        try {
          const targets = JSON.parse(c.target_apps);
          if (Array.isArray(targets)) {
            targets.forEach((t: string) => {
              // Skip rule-format strings (AppName##RuleID) and special SCOPE_OTHER
              if (!t.includes("##") && t !== SCOPE_OTHER) {
                apps.add(t);
              }
            });
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
    <>
      <Flex justify="center" className="pb-6">
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
      <Card className="max-w-5xl w-full mx-auto p-0 overflow-hidden flex flex-col h-[calc(100vh-120px)]">
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
                            appProfiles={appProfiles.map((p) => ({
                              name: p.name,
                              rules: p.rules.map(
                                (r: { id: string; pattern: string }) => ({
                                  id: r.id,
                                  pattern: r.pattern,
                                }),
                              ),
                            }))}
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
    </>
  );
};
