import {
  Badge,
  Box,
  Button,
  Dialog,
  Flex,
  IconButton,
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
  isDirectorySkill: boolean;
}

const MATCH_TYPE_CONFIG: Record<
  string,
  { label: string; color: "amber" | "blue" | "violet" }
> = {
  always: { label: "Always", color: "amber" },
  app_category: { label: "Category", color: "violet" },
  app_name: { label: "App", color: "blue" },
};

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
  // Strip markdown headers and get first meaningful line
  const lines = content
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("---"));
  const first = lines[0] || "";
  // Strip leading "- " for list items
  const cleaned = first.replace(/^[-*]\s*/, "");
  return cleaned.length > 70 ? cleaned.slice(0, 70) + "..." : cleaned;
}

function getMatchLabel(entry: ReferenceEntry): string {
  if (entry.match_type === "always") return "Always Injected";
  if (entry.match_type === "app_category") return entry.name;
  return entry.name;
}

export const ReferencesPanel: React.FC<ReferencesPanelProps> = ({
  skillId,
  isDirectorySkill,
}) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [references, setReferences] = useState<ReferenceEntry[]>([]);
  const [loading, setLoading] = useState(false);

  // Edit dialog state
  const [editDialog, setEditDialog] = useState<{
    open: boolean;
    filename: string;
    content: string;
    isNew: boolean;
    newName: string;
  }>({ open: false, filename: "", content: "", isNew: false, newName: "" });

  // Delete dialog state
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const loadReferences = useCallback(async () => {
    if (!skillId || !isDirectorySkill) return;
    setLoading(true);
    try {
      const refs = (await invoke("get_skill_references", {
        skillId,
      })) as ReferenceEntry[];
      setReferences(refs);
    } catch (e) {
      console.warn("Failed to load references:", e);
    } finally {
      setLoading(false);
    }
  }, [skillId, isDirectorySkill]);

  useEffect(() => {
    if (expanded && isDirectorySkill) {
      loadReferences();
    }
  }, [expanded, skillId, isDirectorySkill, loadReferences]);

  const handleSave = async () => {
    const filename = editDialog.isNew
      ? `${editDialog.newName}.md`
      : editDialog.filename;
    if (!filename || filename === ".md") {
      toast.error("Please enter a valid name");
      return;
    }
    try {
      await invoke("save_skill_reference", {
        skillId,
        filename,
        content: editDialog.content,
      });
      toast.success(editDialog.isNew ? "Reference created" : "Reference saved");
      setEditDialog({ ...editDialog, open: false });
      loadReferences();
    } catch (e) {
      toast.error(`Failed to save: ${e}`);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await invoke("delete_skill_reference", {
        skillId,
        filename: deleteTarget,
      });
      toast.success("Reference deleted");
      setDeleteTarget(null);
      loadReferences();
    } catch (e) {
      toast.error(`Failed to delete: ${e}`);
    }
  };

  if (!isDirectorySkill) {
    return null;
  }

  return (
    <Box mt="3">
      <Flex
        align="center"
        gap="2"
        style={{
          cursor: "pointer",
          userSelect: "none",
          padding: "6px 0",
        }}
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
              setEditDialog({
                open: true,
                filename: "",
                content: "",
                isNew: true,
                newName: "",
              });
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
              Loading...
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
                  "No scene references yet. Add references to adapt this skill's behavior per app.",
                )}
              </Text>
              <Button
                size="1"
                variant="soft"
                onClick={() =>
                  setEditDialog({
                    open: true,
                    filename: "",
                    content: "",
                    isNew: true,
                    newName: "_always",
                  })
                }
              >
                <IconPlus size={12} />
                {t(
                  "settings.postProcessing.prompts.references.createFirst",
                  "Create first reference",
                )}
              </Button>
            </Flex>
          )}
          {references.map((ref) => {
            const config =
              MATCH_TYPE_CONFIG[ref.match_type] || MATCH_TYPE_CONFIG.app_name;
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
                onClick={() =>
                  setEditDialog({
                    open: true,
                    filename: ref.filename,
                    content: ref.content,
                    isNew: false,
                    newName: "",
                  })
                }
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
                      {ref.name}
                    </Text>
                    <Badge size="1" variant="soft" color={config.color}>
                      {getMatchLabel(ref)}
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
                    onClick={() =>
                      setEditDialog({
                        open: true,
                        filename: ref.filename,
                        content: ref.content,
                        isNew: false,
                        newName: "",
                      })
                    }
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

      {/* Hover styles for action buttons */}
      <style>{`
        .ref-item:hover .ref-actions { opacity: 1 !important; }
      `}</style>

      {/* Edit / Create Dialog */}
      <Dialog.Root
        open={editDialog.open}
        onOpenChange={(open) => setEditDialog({ ...editDialog, open })}
      >
        <Dialog.Content maxWidth="560px">
          <Dialog.Title>
            {editDialog.isNew
              ? t(
                  "settings.postProcessing.prompts.references.createTitle",
                  "Create Reference",
                )
              : t(
                  "settings.postProcessing.prompts.references.editTitle",
                  "Edit Reference",
                ) + ` — ${editDialog.filename.replace(".md", "")}`}
          </Dialog.Title>
          <Flex direction="column" gap="3" mt="3">
            {editDialog.isNew && (
              <Flex direction="column" gap="1">
                <Text size="2" weight="medium">
                  {t(
                    "settings.postProcessing.prompts.references.filename",
                    "Name",
                  )}
                </Text>
                <Flex align="center" gap="2">
                  <TextField.Root
                    style={{ flex: 1 }}
                    placeholder="_always, CodeEditor, Slack..."
                    value={editDialog.newName}
                    onChange={(e) =>
                      setEditDialog({
                        ...editDialog,
                        newName: e.target.value,
                      })
                    }
                  />
                  <Text
                    size="2"
                    style={{ color: "var(--gray-9)", flexShrink: 0 }}
                  >
                    .md
                  </Text>
                </Flex>
                <Text size="1" style={{ color: "var(--gray-9)" }}>
                  {t(
                    "settings.postProcessing.prompts.references.filenameHint",
                    "_always = always active, app name (Slack, Obsidian) or category (CodeEditor, Email) for context matching",
                  )}
                </Text>
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
                "Enter scene-specific rules...\n\nExample:\n## Instant messaging rules\n- Keep conversational tone\n- Only fix obvious errors",
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
              'Are you sure you want to delete "{{filename}}"?',
              { filename: deleteTarget?.replace(".md", "") },
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
