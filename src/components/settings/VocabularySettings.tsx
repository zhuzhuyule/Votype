// VocabularySettings - Root-level vocabulary management page
// Combines custom words (hot words) and vocabulary corrections

import {
  AlertDialog,
  Badge,
  Button,
  DropdownMenu,
  Flex,
  IconButton,
  SegmentedControl,
  Table,
  Text,
} from "@radix-ui/themes";
import {
  IconAbc,
  IconApps,
  IconDownload,
  IconLetterCase,
  IconRefresh,
  IconTrash,
  IconWorld,
} from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../hooks/useSettings";
import { Card } from "../ui/Card";
import { HotwordSettings } from "./hotword/HotwordSettings";

interface VocabularyCorrection {
  id: number;
  original_text: string;
  corrected_text: string;
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
    correctedText: string,
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
    return [];
  };

  const selectedScopes = getSelectedScopes();

  // Check if all items are selected (for toggle-all state)
  const isAllSelected = allScopeValues.every((v) => selectedScopes.includes(v));

  // Toggle all: if all selected -> deselect all; otherwise -> select all
  const handleToggleAll = async () => {
    if (isAllSelected) {
      // Deselect all
      await onUpdate(
        correction.id,
        correction.corrected_text,
        false,
        JSON.stringify([]),
      );
    } else {
      // Select all
      await onUpdate(
        correction.id,
        correction.corrected_text,
        false,
        JSON.stringify(allScopeValues),
      );
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
    await onUpdate(
      correction.id,
      correction.corrected_text,
      false,
      JSON.stringify(newScopes),
    );
  };

  const getLabel = () => {
    if (isAllSelected) return t("settings.vocabulary.scope.global");
    if (selectedScopes.length === 0) {
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
  const { getSetting } = useSettings();

  // Delete Confirmation State for corrections
  const [deleteId, setDeleteId] = useState<number | null>(null);

  // Try to derive known apps from various sources (profiles + history if possible)
  // For now we use profiles as a base list of "known" apps
  const appProfiles: any[] = getSetting("app_profiles") || [];

  // Corrections state
  const [corrections, setCorrections] = useState<VocabularyCorrection[]>([]);
  const [activeTab, setActiveTab] = useState("corrections"); // Default to corrections
  const [loadingCorrections, setLoadingCorrections] = useState(true);

  // Group corrections by target word (case-insensitive)
  const groupedCorrections = React.useMemo(() => {
    const groups = new Map<
      string,
      VocabularyCorrection & { triggers: string[] }
    >();

    corrections.forEach((c) => {
      const key = c.corrected_text.toLowerCase();
      const existing = groups.get(key);

      if (existing) {
        // Merge logic
        existing.correction_count += c.correction_count;
        existing.last_seen_at = Math.max(existing.last_seen_at, c.last_seen_at);
        // Add trigger if unique
        if (!existing.triggers.includes(c.original_text)) {
          existing.triggers.push(c.original_text);
        }
        // If the current one is global or has explicit target apps, prefer that config
        if (c.target_apps && !existing.target_apps) {
          existing.target_apps = c.target_apps;
          existing.is_global = c.is_global;
        }
      } else {
        groups.set(key, { ...c, triggers: [c.original_text] });
      }
    });

    return Array.from(groups.values()).sort(
      (a, b) => b.last_seen_at - a.last_seen_at,
    );
  }, [corrections]);

  // Aggregate all known apps from profiles and existing corrections
  const knownApps = React.useMemo(() => {
    const apps = new Set<string>();

    // 1. Add apps from profiles
    appProfiles.forEach((p) => {
      if (p.name) apps.add(p.name);
    });

    // 2. Add apps from existing corrections (skip rule-format strings containing ##)
    corrections.forEach((c) => {
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

  // Correction Delete handlers
  const promptDeleteCorrection = (id: number) => {
    setDeleteId(id);
  };

  const executeDeleteCorrection = async () => {
    if (deleteId === null) return;
    try {
      await invoke("delete_vocabulary_correction", { id: deleteId });
      setCorrections((prev) => prev.filter((c) => c.id !== deleteId));
    } catch (e) {
      console.error("[VocabularySettings] Delete failed:", e);
    } finally {
      setDeleteId(null);
    }
  };

  const cancelDelete = () => {
    setDeleteId(null);
  };

  const handleUpdateScope = useCallback(
    async (
      id: number,
      correctedText: string,
      isGlobal: boolean,
      targetApps: string | null,
    ) => {
      try {
        await invoke("update_vocabulary_correction_scope", {
          correctedText,
          isGlobal,
          targetApps,
        });
        setCorrections((prev) =>
          prev.map((c) =>
            // Update all records with matching corrected_text (case-insensitive) to reflect the new scope
            c.corrected_text.toLowerCase() === correctedText.toLowerCase()
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
      <Card className="max-w-5xl w-full mx-auto p-0 flex flex-col">
        {/* Corrections Tab Content */}
        {activeTab === "corrections" && (
          <Flex direction="column" className="h-full animate-fade-in-up">
            {/* Fixed Header */}
            <div className="p-6 pb-4 border-b border-gray-100 shrink-0 bg-white z-10">
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
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 p-6 bg-gray-50/50">
              {/* Corrections table */}
              {loadingCorrections ? (
                <Text size="2" color="gray" className="py-8 text-center">
                  {t("common.loading")}
                </Text>
              ) : groupedCorrections.length > 0 ? (
                <Table.Root variant="surface">
                  <Table.Header className="sticky top-0 bg-white z-20 shadow-sm">
                    <Table.Row>
                      <Table.ColumnHeaderCell
                        className="whitespace-nowrap"
                        width="35%"
                      >
                        {t("settings.vocabulary.corrections.correction")}{" "}
                        (Target)
                      </Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell
                        className="whitespace-nowrap"
                        width="25%"
                      >
                        Triggers
                      </Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell
                        className="whitespace-nowrap"
                        width="15%"
                        align="center"
                      >
                        {t("settings.vocabulary.corrections.count")}
                      </Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell
                        className="whitespace-nowrap"
                        width="20%"
                        align="center"
                      >
                        {t("settings.vocabulary.corrections.scope")}
                      </Table.ColumnHeaderCell>
                      <Table.ColumnHeaderCell
                        className="whitespace-nowrap"
                        width="5%"
                        align="right"
                      >
                        {t("settings.vocabulary.actions")}
                      </Table.ColumnHeaderCell>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {groupedCorrections.map((c) => (
                      <Table.Row key={c.id}>
                        <Table.Cell>
                          <Text
                            size="2"
                            weight="bold"
                            className="font-mono text-green-600 truncate block"
                            title={c.corrected_text}
                          >
                            {c.corrected_text}
                          </Text>
                        </Table.Cell>
                        <Table.Cell>
                          <Flex wrap="wrap" gap="1">
                            {c.triggers.slice(0, 5).map((trigger, i) => (
                              <Badge
                                key={i}
                                size="1"
                                color="gray"
                                variant="soft"
                              >
                                {trigger}
                              </Badge>
                            ))}
                            {c.triggers.length > 5 && (
                              <Badge size="1" color="gray" variant="soft">
                                +{c.triggers.length - 5}
                              </Badge>
                            )}
                          </Flex>
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
                            onClick={() => promptDeleteCorrection(c.id)}
                            title="Delete this variant"
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
            </div>
          </Flex>
        )}

        {/* Hot Words Tab Content */}
        {activeTab === "hotwords" && <HotwordSettings />}
      </Card>

      {/* Delete Confirmation Dialog */}
      <AlertDialog.Root open={deleteId !== null} onOpenChange={cancelDelete}>
        <AlertDialog.Content maxWidth="450px">
          <AlertDialog.Title>
            {t("settings.vocabulary.deleteConfirm.title", "Confirm Deletion")}
          </AlertDialog.Title>
          <AlertDialog.Description size="2">
            {t(
              "settings.vocabulary.deleteConfirm.correctionMessage",
              "Are you sure you want to delete this correction rule? This action cannot be undone.",
            )}
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray" onClick={cancelDelete}>
                {t("common.cancel")}
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button
                variant="solid"
                color="red"
                onClick={executeDeleteCorrection}
              >
                {t("common.delete")}
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </>
  );
};
