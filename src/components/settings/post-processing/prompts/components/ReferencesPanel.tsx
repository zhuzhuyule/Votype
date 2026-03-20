import {
  Badge,
  Box,
  Button,
  Dialog,
  Flex,
  IconButton,
  Select,
  Text,
  TextArea,
  TextField,
} from "@radix-ui/themes";
import {
  IconChevronDown,
  IconChevronUp,
  IconCode,
  IconDeviceDesktop,
  IconMail,
  IconMessage,
  IconNote,
  IconPencil,
  IconPlus,
  IconStar,
  IconTerminal,
  IconTrash,
  IconWorld,
} from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import React, { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

interface ReferenceEntry {
  name: string;
  filename: string;
  content: string;
  match_type: string; // "always" | "app_name" | "app_category"
}

interface ReferencesPanelProps {
  skillId: string;
  isBuiltin: boolean;
}

type CreateType = "always" | "category" | "app";

const CATEGORY_OPTIONS = [
  { value: "CodeEditor", label: "Code Editor" },
  { value: "Terminal", label: "Terminal" },
  { value: "InstantMessaging", label: "IM / Chat" },
  { value: "Email", label: "Email" },
  { value: "Notes", label: "Notes" },
  { value: "Browser", label: "Browser" },
  { value: "Other", label: "Other" },
];

function getIcon(entry: ReferenceEntry) {
  const name = entry.name.toLowerCase();
  const size = 14;
  if (entry.match_type === "always")
    return <IconStar size={size} style={{ color: "var(--amber-9)" }} />;
  if (name === "codeeditor")
    return <IconCode size={size} style={{ color: "var(--blue-9)" }} />;
  if (name === "terminal")
    return <IconTerminal size={size} style={{ color: "var(--gray-10)" }} />;
  if (name === "instantmessaging")
    return <IconMessage size={size} style={{ color: "var(--green-9)" }} />;
  if (name === "email")
    return <IconMail size={size} style={{ color: "var(--orange-9)" }} />;
  if (name === "notes")
    return <IconNote size={size} style={{ color: "var(--yellow-9)" }} />;
  if (name === "browser")
    return <IconWorld size={size} style={{ color: "var(--cyan-9)" }} />;
  return <IconDeviceDesktop size={size} style={{ color: "var(--gray-9)" }} />;
}

function getContentPreview(content: string): string {
  const lines = content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("---"));
  const first = lines[0] || "";
  const cleaned = first.replace(/^[-*]\s*/, "");
  return cleaned.length > 70 ? cleaned.slice(0, 70) + "..." : cleaned;
}

/** User-friendly display name for a reference entry */
function getDisplayName(
  entry: ReferenceEntry,
  t: (k: string, d: string) => string,
): string {
  if (entry.match_type === "always")
    return t(
      "settings.postProcessing.prompts.references.alwaysName",
      "General Rules",
    );
  return entry.name;
}

function getMatchBadge(
  entry: ReferenceEntry,
  t: (k: string, d: string) => string,
): { label: string; color: "amber" | "blue" | "violet" } {
  if (entry.match_type === "always")
    return {
      label: t(
        "settings.postProcessing.prompts.references.badgeAlways",
        "Always Active",
      ),
      color: "amber",
    };
  if (entry.match_type === "app_category")
    return { label: entry.name, color: "violet" };
  return { label: entry.name, color: "blue" };
}

export const ReferencesPanel: React.FC<ReferencesPanelProps> = ({
  skillId,
  isBuiltin,
}) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [references, setReferences] = useState<ReferenceEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [isDirectory, setIsDirectory] = useState<boolean | null>(null);

  // Edit dialog state
  const [editDialog, setEditDialog] = useState<{
    open: boolean;
    filename: string;
    content: string;
    isNew: boolean;
  }>({ open: false, filename: "", content: "", isNew: false });

  // Create dialog state (separate from edit)
  const [createType, setCreateType] = useState<CreateType>("category");
  const [createCategory, setCreateCategory] = useState("CodeEditor");
  const [createAppName, setCreateAppName] = useState("");

  // Delete dialog state
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const loadReferences = useCallback(async () => {
    if (!skillId || isBuiltin) return;
    setLoading(true);
    try {
      const dirSkill = (await invoke("is_directory_skill", {
        skillId,
      })) as boolean;
      setIsDirectory(dirSkill);
      if (dirSkill) {
        const refs = (await invoke("get_skill_references", {
          skillId,
        })) as ReferenceEntry[];
        setReferences(refs);
      } else {
        setReferences([]);
      }
    } catch (e) {
      console.warn("Failed to load references:", e);
    } finally {
      setLoading(false);
    }
  }, [skillId, isBuiltin]);

  useEffect(() => {
    if (!isBuiltin) {
      loadReferences();
    }
  }, [skillId, isBuiltin, loadReferences]);

  const resolveFilename = (): string | null => {
    if (!editDialog.isNew) return editDialog.filename;
    switch (createType) {
      case "always":
        return "_always.md";
      case "category":
        return createCategory ? `${createCategory}.md` : null;
      case "app":
        return createAppName.trim() ? `${createAppName.trim()}.md` : null;
    }
  };

  const handleSave = async () => {
    const filename = resolveFilename();
    if (!filename) {
      toast.error(
        t(
          "settings.postProcessing.prompts.references.errorNoName",
          "Please enter a name",
        ),
      );
      return;
    }
    try {
      await invoke("save_skill_reference", {
        skillId,
        filename,
        content: editDialog.content,
      });
      toast.success(
        editDialog.isNew
          ? t(
              "settings.postProcessing.prompts.references.created",
              "Reference created",
            )
          : t(
              "settings.postProcessing.prompts.references.saved",
              "Reference saved",
            ),
      );
      setEditDialog({ ...editDialog, open: false });
      loadReferences();
    } catch (e) {
      toast.error(
        `${t("settings.postProcessing.prompts.references.errorSave", "Failed to save")}: ${e}`,
      );
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await invoke("delete_skill_reference", {
        skillId,
        filename: deleteTarget,
      });
      toast.success(
        t(
          "settings.postProcessing.prompts.references.deleted",
          "Reference deleted",
        ),
      );
      setDeleteTarget(null);
      loadReferences();
    } catch (e) {
      toast.error(
        `${t("settings.postProcessing.prompts.references.errorDelete", "Failed to delete")}: ${e}`,
      );
    }
  };

  const openCreate = () => {
    setCreateType("category");
    setCreateCategory("CodeEditor");
    setCreateAppName("");
    setEditDialog({ open: true, filename: "", content: "", isNew: true });
  };

  const openEdit = (ref: ReferenceEntry) => {
    setEditDialog({
      open: true,
      filename: ref.filename,
      content: ref.content,
      isNew: false,
    });
  };

  // Hide for builtin skills and single-file skills
  if (isBuiltin || isDirectory === false) return null;
  // Still loading the check
  if (isDirectory === null) return null;

  return (
    <Box mt="3">
      <Flex
        align="center"
        gap="2"
        style={{ cursor: "pointer", userSelect: "none", padding: "6px 0" }}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
        <Text size="2" weight="medium" style={{ color: "var(--gray-11)" }}>
          {t(
            "settings.postProcessing.prompts.references.title",
            "Scene References",
          )}
        </Text>
        {references.length > 0 && (
          <Badge size="1" variant="soft" color="gray">
            {references.length}
          </Badge>
        )}
        {expanded && (
          <Button
            size="1"
            variant="ghost"
            style={{ marginLeft: "auto" }}
            onClick={(e) => {
              e.stopPropagation();
              openCreate();
            }}
          >
            <IconPlus size={12} />
            {t("settings.postProcessing.prompts.references.add", "Add")}
          </Button>
        )}
      </Flex>

      {expanded && (
        <Flex direction="column" gap="1" mt="1">
          {loading && (
            <Text size="1" style={{ color: "var(--gray-9)", padding: "8px 0" }}>
              {t("common.loading", "Loading...")}
            </Text>
          )}
          {!loading && references.length === 0 && (
            <Flex
              direction="column"
              align="center"
              gap="2"
              style={{
                padding: "20px",
                border: "1px dashed var(--gray-6)",
                borderRadius: 8,
              }}
            >
              <Text size="1" style={{ color: "var(--gray-9)" }}>
                {t(
                  "settings.postProcessing.prompts.references.empty",
                  "No scene references yet. Add references to adapt behavior per app.",
                )}
              </Text>
              <Button size="1" variant="soft" onClick={openCreate}>
                <IconPlus size={12} />
                {t(
                  "settings.postProcessing.prompts.references.createFirst",
                  "Create first reference",
                )}
              </Button>
            </Flex>
          )}
          {references.map((ref) => {
            const badge = getMatchBadge(ref, t);
            const preview = getContentPreview(ref.content);
            return (
              <Flex
                key={ref.filename}
                align="start"
                gap="2"
                className="ref-item"
                style={{
                  padding: "8px 10px",
                  borderRadius: 6,
                  cursor: "pointer",
                  transition: "background 0.1s",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "var(--gray-3)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "transparent")
                }
                onClick={() => openEdit(ref)}
              >
                <Flex
                  align="center"
                  justify="center"
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 6,
                    background: "var(--gray-3)",
                    flexShrink: 0,
                    marginTop: 1,
                  }}
                >
                  {getIcon(ref)}
                </Flex>
                <Flex
                  direction="column"
                  gap="1"
                  style={{ flex: 1, minWidth: 0 }}
                >
                  <Flex align="center" gap="2">
                    <Text size="2" weight="medium">
                      {getDisplayName(ref, t)}
                    </Text>
                    <Badge size="1" variant="soft" color={badge.color}>
                      {badge.label}
                    </Badge>
                  </Flex>
                  {preview && (
                    <Text
                      size="1"
                      style={{
                        color: "var(--gray-9)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        lineHeight: 1.3,
                      }}
                    >
                      {preview}
                    </Text>
                  )}
                </Flex>
                <Flex
                  gap="1"
                  className="ref-actions"
                  style={{
                    flexShrink: 0,
                    opacity: 0,
                    transition: "opacity 0.1s",
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <IconButton
                    size="1"
                    variant="ghost"
                    onClick={() => openEdit(ref)}
                  >
                    <IconPencil size={13} />
                  </IconButton>
                  <IconButton
                    size="1"
                    variant="ghost"
                    color="red"
                    onClick={() => setDeleteTarget(ref.filename)}
                  >
                    <IconTrash size={13} />
                  </IconButton>
                </Flex>
              </Flex>
            );
          })}
        </Flex>
      )}

      {/* Hover styles */}
      <style>{`.ref-item:hover .ref-actions { opacity: 1 !important; }`}</style>

      {/* Create / Edit Dialog */}
      <Dialog.Root
        open={editDialog.open}
        onOpenChange={(open) => setEditDialog({ ...editDialog, open })}
      >
        <Dialog.Content maxWidth="560px">
          <Dialog.Title>
            {editDialog.isNew
              ? t(
                  "settings.postProcessing.prompts.references.createTitle",
                  "Create Scene Reference",
                )
              : t(
                  "settings.postProcessing.prompts.references.editTitle",
                  "Edit Scene Reference",
                ) +
                ` \u2014 ${editDialog.filename.replace(".md", "").replace("_always", t("settings.postProcessing.prompts.references.alwaysName", "General Rules"))}`}
          </Dialog.Title>
          <Flex direction="column" gap="3" mt="3">
            {editDialog.isNew && (
              <Flex direction="column" gap="2">
                <Text size="2" weight="medium">
                  {t(
                    "settings.postProcessing.prompts.references.matchType",
                    "Match Type",
                  )}
                </Text>
                <Select.Root
                  value={createType}
                  onValueChange={(v) => setCreateType(v as CreateType)}
                >
                  <Select.Trigger style={{ width: "100%" }} />
                  <Select.Content>
                    <Select.Item value="always">
                      {t(
                        "settings.postProcessing.prompts.references.typeAlways",
                        "General Rules (always active)",
                      )}
                    </Select.Item>
                    <Select.Item value="category">
                      {t(
                        "settings.postProcessing.prompts.references.typeCategory",
                        "By App Category",
                      )}
                    </Select.Item>
                    <Select.Item value="app">
                      {t(
                        "settings.postProcessing.prompts.references.typeApp",
                        "By App Name",
                      )}
                    </Select.Item>
                  </Select.Content>
                </Select.Root>

                {createType === "category" && (
                  <Select.Root
                    value={createCategory}
                    onValueChange={setCreateCategory}
                  >
                    <Select.Trigger style={{ width: "100%" }} />
                    <Select.Content>
                      {CATEGORY_OPTIONS.map((opt) => (
                        <Select.Item key={opt.value} value={opt.value}>
                          {opt.label}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                )}

                {createType === "app" && (
                  <TextField.Root
                    placeholder={t(
                      "settings.postProcessing.prompts.references.appNamePlaceholder",
                      "e.g. Slack, Obsidian, WeChat",
                    )}
                    value={createAppName}
                    onChange={(e) => setCreateAppName(e.target.value)}
                  />
                )}
              </Flex>
            )}
            <TextArea
              style={{
                minHeight: 240,
                fontFamily:
                  "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace",
                fontSize: 13,
                lineHeight: 1.5,
              }}
              placeholder={t(
                "settings.postProcessing.prompts.references.contentPlaceholder",
                "Enter scene-specific rules for this context...\n\nExample:\n## IM/Chat Rules\n- Keep conversational tone\n- Only fix obvious errors\n- Preserve emoji",
              )}
              value={editDialog.content}
              onChange={(e) =>
                setEditDialog({ ...editDialog, content: e.target.value })
              }
            />
          </Flex>
          <Flex gap="3" mt="4" justify="end">
            <Dialog.Close>
              <Button variant="soft" color="gray">
                {t("common.cancel", "Cancel")}
              </Button>
            </Dialog.Close>
            <Button onClick={handleSave}>{t("common.save", "Save")}</Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>

      {/* Delete Confirmation */}
      <Dialog.Root
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <Dialog.Content maxWidth="400px">
          <Dialog.Title>
            {t(
              "settings.postProcessing.prompts.references.deleteTitle",
              "Delete Reference",
            )}
          </Dialog.Title>
          <Dialog.Description size="2" mb="4">
            {t(
              "settings.postProcessing.prompts.references.deleteConfirm",
              'Are you sure you want to delete "{{name}}"?',
              {
                name: deleteTarget
                  ?.replace(".md", "")
                  .replace(
                    "_always",
                    t(
                      "settings.postProcessing.prompts.references.alwaysName",
                      "General Rules",
                    ),
                  ),
              },
            )}
          </Dialog.Description>
          <Flex gap="3" justify="end">
            <Dialog.Close>
              <Button variant="soft" color="gray">
                {t("common.cancel", "Cancel")}
              </Button>
            </Dialog.Close>
            <Button color="red" onClick={handleDelete}>
              {t("common.delete", "Delete")}
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
    </Box>
  );
};
