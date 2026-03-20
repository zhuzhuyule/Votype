import {
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
  IconFile,
  IconPencil,
  IconPlus,
  IconStar,
  IconTrash,
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

const APP_CATEGORIES = [
  "CodeEditor",
  "Terminal",
  "InstantMessaging",
  "Email",
  "Notes",
  "Browser",
  "Other",
];

const CATEGORY_ICONS: Record<string, string> = {
  _always: "\u2605", // star
  CodeEditor: "\uD83D\uDCBB", // laptop
  Terminal: ">_",
  InstantMessaging: "\uD83D\uDCAC", // speech bubble
  Email: "\u2709", // envelope
  Notes: "\uD83D\uDCDD", // memo
  Browser: "\uD83C\uDF10", // globe
  Other: "\uD83D\uDCC4", // page
};

function getMatchLabel(entry: ReferenceEntry): string {
  if (entry.match_type === "always") return "Always Injected";
  if (entry.match_type === "app_category")
    return `app_category = ${entry.name}`;
  return `app_name = ${entry.name}`;
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
        <Text
          size="1"
          style={{
            color: "var(--gray-9)",
            background: "var(--gray-3)",
            padding: "0 6px",
            borderRadius: 10,
          }}
        >
          {references.length}
        </Text>
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
        <Flex direction="column" gap="1" mt="2">
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
                  "No scene references yet",
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
          {references.map((ref) => (
            <Flex
              key={ref.filename}
              align="center"
              gap="2"
              style={{
                padding: "8px 12px",
                background: "var(--gray-2)",
                borderRadius: 8,
                border: "1px solid var(--gray-4)",
              }}
            >
              <Text size="2" style={{ width: 24, textAlign: "center" }}>
                {ref.match_type === "always" ? (
                  <IconStar size={14} style={{ color: "var(--amber-9)" }} />
                ) : (
                  <IconFile size={14} style={{ color: "var(--gray-9)" }} />
                )}
              </Text>
              <Flex direction="column" style={{ flex: 1, minWidth: 0 }}>
                <Text size="2" weight="medium">
                  {ref.filename}
                </Text>
                <Text
                  size="1"
                  style={{
                    color: "var(--gray-9)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {getMatchLabel(ref)}
                </Text>
              </Flex>
              <Flex gap="1" style={{ flexShrink: 0 }}>
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
                  <IconPencil size={14} />
                </IconButton>
                <IconButton
                  size="1"
                  variant="ghost"
                  color="red"
                  onClick={() => setDeleteTarget(ref.filename)}
                >
                  <IconTrash size={14} />
                </IconButton>
              </Flex>
            </Flex>
          ))}
        </Flex>
      )}

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
                )}
          </Dialog.Title>
          <Flex direction="column" gap="3" mt="3">
            {editDialog.isNew && (
              <Flex direction="column" gap="1">
                <Text size="2" weight="medium">
                  {t(
                    "settings.postProcessing.prompts.references.filename",
                    "Filename",
                  )}
                </Text>
                <Flex align="center" gap="2">
                  <TextField.Root
                    style={{ flex: 1 }}
                    placeholder="_always, CodeEditor, Slack..."
                    value={editDialog.newName}
                    onChange={(e) =>
                      setEditDialog({ ...editDialog, newName: e.target.value })
                    }
                  />
                  <Text size="2" style={{ color: "var(--gray-9)" }}>
                    .md
                  </Text>
                </Flex>
                <Text size="1" style={{ color: "var(--gray-9)" }}>
                  {t(
                    "settings.postProcessing.prompts.references.filenameHint",
                    "Use _always for always-on, app name (e.g. Slack) or category (e.g. CodeEditor) for context matching",
                  )}
                </Text>
              </Flex>
            )}
            {!editDialog.isNew && (
              <Text size="2" style={{ color: "var(--gray-11)" }}>
                {editDialog.filename} —{" "}
                {getMatchLabel({
                  name: editDialog.filename.replace(".md", ""),
                  filename: editDialog.filename,
                  content: "",
                  match_type: editDialog.filename.startsWith("_always")
                    ? "always"
                    : "app_name",
                })}
              </Text>
            )}
            <TextArea
              style={{ minHeight: 200, fontFamily: "monospace", fontSize: 13 }}
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
              "Are you sure you want to delete {{filename}}?",
              { filename: deleteTarget },
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
