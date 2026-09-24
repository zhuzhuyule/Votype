// CategoryManageDialog - Dialog for managing hotword categories

import {
  Badge,
  Box,
  Button,
  Dialog,
  Flex,
  IconButton,
  Select,
  Text,
  TextField,
  Tooltip,
} from "@radix-ui/themes";
import {
  IconPencil,
  IconPlus,
  IconSettings,
  IconTrash,
} from "@tabler/icons-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import type { HotwordCategoryMeta } from "../../../types/hotword";
import { resolveIcon } from "../../../lib/hotwordIcons";
import { IconPicker } from "../../shared/IconPicker";

const RADIX_COLORS = [
  "gray",
  "green",
  "orange",
  "blue",
  "purple",
  "red",
  "cyan",
  "amber",
  "teal",
  "pink",
] as const;

// i18n key 而非展示文案：见 src/types/hotword.ts 顶部说明。
const COLOR_LABEL_KEYS: Record<string, string> = {
  gray: "hotword.categoryDialog.colors.gray",
  green: "hotword.categoryDialog.colors.green",
  orange: "hotword.categoryDialog.colors.orange",
  blue: "hotword.categoryDialog.colors.blue",
  purple: "hotword.categoryDialog.colors.purple",
  red: "hotword.categoryDialog.colors.red",
  cyan: "hotword.categoryDialog.colors.cyan",
  amber: "hotword.categoryDialog.colors.amber",
  teal: "hotword.categoryDialog.colors.teal",
  pink: "hotword.categoryDialog.colors.pink",
};

const ID_REGEX = /^[a-zA-Z0-9-]+$/;

interface CategoryManageDialogProps {
  categories: HotwordCategoryMeta[];
  onAdd: (
    id: string,
    label: string,
    color: string,
    icon: string,
  ) => Promise<HotwordCategoryMeta>;
  onUpdate: (
    id: string,
    updates: { label?: string; color?: string; icon?: string },
  ) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

/** Color select with swatch in each item */
const ColorSelect: React.FC<{
  value: string;
  onChange: (v: string) => void;
}> = ({ value, onChange }) => {
  const { t } = useTranslation();
  return (
    <Select.Root size="1" value={value} onValueChange={onChange}>
      <Select.Trigger />
      <Select.Content>
        {RADIX_COLORS.map((c) => (
          <Select.Item key={c} value={c}>
            <Flex align="center" gap="2">
              <Box
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "2px",
                  backgroundColor: `var(--${c}-9)`,
                  flexShrink: 0,
                }}
              />
              {COLOR_LABEL_KEYS[c] ? t(COLOR_LABEL_KEYS[c]) : c}
            </Flex>
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );
};

export const CategoryManageDialog: React.FC<CategoryManageDialogProps> = ({
  categories,
  onAdd,
  onUpdate,
  onDelete,
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newId, setNewId] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newColor, setNewColor] = useState("gray");
  const [newIcon, setNewIcon] = useState("IconTag");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editColor, setEditColor] = useState("");
  const [editIcon, setEditIcon] = useState("");
  const [error, setError] = useState<string | null>(null);

  const idValid = newId.trim() === "" || ID_REGEX.test(newId.trim());

  const handleAdd = async () => {
    const trimmedId = newId.trim();
    if (!trimmedId || !newLabel.trim()) return;
    if (!ID_REGEX.test(trimmedId)) {
      setError(t("hotword.categoryDialog.idInvalid"));
      return;
    }
    setError(null);
    try {
      await onAdd(trimmedId, newLabel.trim(), newColor, newIcon);
      setNewId("");
      setNewLabel("");
      setNewColor("gray");
      setNewIcon("IconTag");
      setAdding(false);
    } catch (e) {
      const msg = String(e);
      if (msg.includes("UNIQUE") || msg.includes("already exists")) {
        setError(t("hotword.categoryDialog.idDuplicate", { id: trimmedId }));
      } else {
        setError(t("hotword.categoryDialog.addFailed"));
      }
    }
  };

  const startEdit = (cat: HotwordCategoryMeta) => {
    setEditingId(cat.id);
    setEditLabel(cat.label);
    setEditColor(cat.color);
    setEditIcon(cat.icon);
    setError(null);
  };

  const handleSaveEdit = async () => {
    if (!editingId || !editLabel.trim()) return;
    setError(null);
    try {
      await onUpdate(editingId, {
        label: editLabel.trim(),
        color: editColor,
        icon: editIcon,
      });
      setEditingId(null);
    } catch (e) {
      setError(t("hotword.categoryDialog.saveFailed"));
    }
  };

  const handleDelete = async (id: string) => {
    setError(null);
    try {
      await onDelete(id);
    } catch (e) {
      setError(t("hotword.categoryDialog.deleteFailed"));
    }
  };

  const handleOpenChange = (v: boolean) => {
    setOpen(v);
    if (!v) {
      setAdding(false);
      setEditingId(null);
      setError(null);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Tooltip content={t("hotword.categoryDialog.manageTooltip")}>
        <IconButton
          size="2"
          variant="soft"
          color="gray"
          onClick={() => setOpen(true)}
        >
          <IconSettings size={14} />
        </IconButton>
      </Tooltip>
      <Dialog.Content maxWidth="480px">
        <Dialog.Title>{t("hotword.categoryDialog.title")}</Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="4">
          {t("hotword.categoryDialog.description")}
        </Dialog.Description>

        {error && (
          <Text size="1" color="red" weight="medium" className="mb-2 block">
            {error}
          </Text>
        )}

        <Flex direction="column" gap="2">
          {categories.map((cat) => {
            const CatIcon = resolveIcon(cat.icon);
            const isEditing = editingId === cat.id;

            if (isEditing) {
              return (
                <div
                  key={cat.id}
                  className="p-2 rounded border border-blue-200 bg-blue-50/50"
                >
                  <Flex direction="column" gap="2">
                    <TextField.Root
                      size="1"
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      placeholder={t("hotword.categoryDialog.namePlaceholder")}
                    />
                    <Flex gap="2" align="center">
                      <ColorSelect value={editColor} onChange={setEditColor} />
                      <IconPicker value={editIcon} onChange={setEditIcon} />
                    </Flex>
                    <Flex gap="2" justify="end">
                      <Button
                        size="1"
                        variant="soft"
                        color="gray"
                        onClick={() => setEditingId(null)}
                      >
                        {t("common.cancel")}
                      </Button>
                      <Button
                        size="1"
                        variant="solid"
                        onClick={handleSaveEdit}
                        disabled={!editLabel.trim()}
                      >
                        {t("common.save")}
                      </Button>
                    </Flex>
                  </Flex>
                </div>
              );
            }

            return (
              <Flex
                key={cat.id}
                align="center"
                gap="2"
                className="px-2 py-1.5 rounded hover:bg-gray-50"
              >
                <Badge size="1" variant="soft" color={cat.color as never}>
                  <Flex align="center" gap="1">
                    <CatIcon size={12} />
                    {cat.label}
                  </Flex>
                </Badge>
                <Text size="1" color="gray" className="flex-1">
                  {cat.id}
                </Text>
                {cat.is_builtin && (
                  <Text size="1" color="gray" className="text-[10px]">
                    {t("hotword.categoryDialog.builtin")}
                  </Text>
                )}
                <Flex gap="1">
                  <Tooltip content={t("common.edit")}>
                    <IconButton
                      size="1"
                      variant="ghost"
                      onClick={() => startEdit(cat)}
                    >
                      <IconPencil size={12} />
                    </IconButton>
                  </Tooltip>
                  {!cat.is_builtin && (
                    <Tooltip
                      content={t("hotword.categoryDialog.deleteTooltip")}
                    >
                      <IconButton
                        size="1"
                        variant="ghost"
                        color="red"
                        onClick={() => handleDelete(cat.id)}
                      >
                        <IconTrash size={12} />
                      </IconButton>
                    </Tooltip>
                  )}
                </Flex>
              </Flex>
            );
          })}

          {adding ? (
            <div className="p-2 rounded border border-dashed border-gray-300 bg-gray-50/50">
              <Flex direction="column" gap="2">
                <Flex gap="2">
                  <TextField.Root
                    size="1"
                    value={newId}
                    onChange={(e) => setNewId(e.target.value)}
                    placeholder={t("hotword.categoryDialog.idPlaceholder")}
                    className="flex-1"
                    color={!idValid ? "red" : undefined}
                  />
                  <TextField.Root
                    size="1"
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    placeholder={t("hotword.categoryDialog.labelPlaceholder")}
                    className="flex-1"
                  />
                </Flex>
                {!idValid && (
                  <Text size="1" color="red">
                    {t("hotword.categoryDialog.idInvalidDetail")}
                  </Text>
                )}
                <Flex gap="2" align="center">
                  <ColorSelect value={newColor} onChange={setNewColor} />
                  <IconPicker value={newIcon} onChange={setNewIcon} />
                </Flex>
                <Flex gap="2" justify="end">
                  <Button
                    size="1"
                    variant="soft"
                    color="gray"
                    onClick={() => {
                      setAdding(false);
                      setError(null);
                    }}
                  >
                    {t("common.cancel")}
                  </Button>
                  <Button
                    size="1"
                    variant="solid"
                    onClick={handleAdd}
                    disabled={!newId.trim() || !newLabel.trim() || !idValid}
                  >
                    {t("common.add")}
                  </Button>
                </Flex>
              </Flex>
            </div>
          ) : (
            <Button
              size="1"
              variant="soft"
              onClick={() => setAdding(true)}
              className="self-start"
            >
              <IconPlus size={12} />
              {t("hotword.categoryDialog.addCategory")}
            </Button>
          )}
        </Flex>

        <Flex mt="4" justify="end">
          <Dialog.Close>
            <Button variant="soft" color="gray">
              {t("common.close")}
            </Button>
          </Dialog.Close>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
};
