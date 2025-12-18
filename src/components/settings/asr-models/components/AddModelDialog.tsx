// AddModelDialog - Dialog for adding or editing a custom ASR model

import {
    Badge,
    Box,
    Button,
    Dialog,
    Flex,
    Text,
    TextField,
    Tooltip,
} from "@radix-ui/themes";
import { IconPlus, IconX } from "@tabler/icons-react";
import { TFunction } from "i18next";
import React from "react";

interface AddModelDialogProps {
    t: TFunction;
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
    editMode: boolean;
    url: string;
    setUrl: (value: string) => void;
    addName: string;
    setAddName: (value: string) => void;
    addTags: Set<string>;
    customTagInput: string;
    setCustomTagInput: (value: string) => void;
    onToggleTag: (tag: string) => void;
    onAddCustomTag: () => void;
    onOpenAddDialog: () => void;
    onSubmit: () => void;
    busy: boolean;
    error: string | null;
}

export const AddModelDialog: React.FC<AddModelDialogProps> = ({
    t,
    isOpen,
    onOpenChange,
    editMode,
    url,
    setUrl,
    addName,
    setAddName,
    addTags,
    customTagInput,
    setCustomTagInput,
    onToggleTag,
    onAddCustomTag,
    onOpenAddDialog,
    onSubmit,
    busy,
    error,
}) => {
    return (
        <Dialog.Root open={isOpen} onOpenChange={onOpenChange}>
            <Dialog.Trigger>
                <Button onClick={onOpenAddDialog}>
                    <IconPlus size={16} />
                    {t("settings.asrModels.install.button")}
                </Button>
            </Dialog.Trigger>
            <Dialog.Content style={{ maxWidth: 500 }}>
                <Dialog.Title>
                    {editMode
                        ? t("settings.asrModels.install.editTitle") || "Edit Custom Model"
                        : t("settings.asrModels.install.title") || "Add Custom Model"}
                </Dialog.Title>
                <Dialog.Description size="2" mb="4">
                    {editMode
                        ? t("settings.asrModels.install.editDescription") ||
                        "Update the name or tags for this model."
                        : t("settings.asrModels.install.description") ||
                        "Enter the URL of the model archive (tar.gz, tar.bz2, etc)."}
                </Dialog.Description>

                <Flex direction="column" gap="3">
                    <Box>
                        <Text as="div" size="2" mb="1" weight="bold">
                            {t("settings.asrModels.install.urlLabel")}
                        </Text>
                        <TextField.Root
                            placeholder={t("settings.asrModels.install.placeholder")}
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            disabled={editMode}
                        />
                    </Box>

                    <Box>
                        <Text as="div" size="2" mb="1" weight="bold">
                            {t("settings.asrModels.install.nameLabel")}
                        </Text>
                        <TextField.Root
                            placeholder="My Model"
                            value={addName}
                            onChange={(e) => setAddName(e.target.value)}
                        />
                    </Box>

                    <Box>
                        <Text as="div" size="2" mb="1" weight="bold">
                            {t("settings.asrModels.install.tagsLabel")}
                        </Text>
                        <Flex gap="2" wrap="wrap" mb="2">
                            {["multilingual", "zh", "en", "ja", "ko"].map((tag) => (
                                <Badge
                                    key={tag}
                                    color={addTags.has(tag) ? "blue" : "gray"}
                                    variant={addTags.has(tag) ? "solid" : "soft"}
                                    style={{ cursor: "pointer" }}
                                    onClick={() => onToggleTag(tag)}
                                >
                                    {t(`settings.asrModels.languages.${tag}`)}
                                </Badge>
                            ))}
                        </Flex>

                        <Flex gap="2">
                            <TextField.Root
                                className="flex-1"
                                placeholder={t("settings.asrModels.install.customTagPlaceholder")}
                                value={customTagInput}
                                onChange={(e) => setCustomTagInput(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                        e.preventDefault();
                                        onAddCustomTag();
                                    }
                                }}
                            />
                            <Tooltip content={t("settings.asrModels.install.addCustomTagButton")}>
                                <Button
                                    variant="soft"
                                    onClick={onAddCustomTag}
                                    disabled={!customTagInput.trim()}
                                >
                                    <IconPlus size={16} />
                                </Button>
                            </Tooltip>
                        </Flex>

                        {addTags.size > 0 && (
                            <Flex gap="2" wrap="wrap" mt="2">
                                {Array.from(addTags).map((tag) => (
                                    <Badge key={tag} variant="surface" color="blue">
                                        {tag}
                                        <IconX
                                            size={12}
                                            style={{ cursor: "pointer", marginLeft: 4 }}
                                            onClick={() => onToggleTag(tag)}
                                        />
                                    </Badge>
                                ))}
                            </Flex>
                        )}
                    </Box>

                    {error && (
                        <Text color="red" size="2">
                            {error}
                        </Text>
                    )}
                </Flex>

                <Flex gap="3" mt="4" justify="end">
                    <Dialog.Close>
                        <Button variant="soft" color="gray">
                            {t("common.cancel")}
                        </Button>
                    </Dialog.Close>
                    <Button onClick={onSubmit} disabled={busy || !url.trim()}>
                        {busy
                            ? editMode
                                ? "Updating..."
                                : "Adding..."
                            : editMode
                                ? t("common.save") || "Save"
                                : t("common.add")}
                    </Button>
                </Flex>
            </Dialog.Content>
        </Dialog.Root>
    );
};
