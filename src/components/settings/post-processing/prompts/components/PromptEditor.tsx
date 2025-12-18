// PromptEditor - Form for editing a single prompt

import { Box, Flex, Grid, Text, TextField } from "@radix-ui/themes";
import { TFunction } from "i18next";
import React from "react";
import { Dropdown } from "../../../../ui/Dropdown";
import { ResizableEditor } from "./ResizableEditor";
import { TagInput } from "./TagInput";

interface TextModelOption {
    value: string;
    label: string;
}

interface PromptEditorProps {
    t: TFunction;
    draftName: string;
    setDraftName: (value: string) => void;
    draftContent: string;
    setDraftContent: (value: string) => void;
    draftModelId: string | null;
    setDraftModelId: (value: string | null) => void;
    currentAliases: string[];
    currentAliasInput: string;
    setCurrentAliasInput: (value: string) => void;
    aliasError: string | null;
    setAliasError: (error: string | null) => void;
    onAddAlias: () => void;
    onRemoveAlias: (alias: string) => void;
    textModels: TextModelOption[];
}

export const PromptEditor: React.FC<PromptEditorProps> = ({
    t,
    draftName,
    setDraftName,
    draftContent,
    setDraftContent,
    draftModelId,
    setDraftModelId,
    currentAliases,
    currentAliasInput,
    setCurrentAliasInput,
    aliasError,
    setAliasError,
    onAddAlias,
    onRemoveAlias,
    textModels,
}) => {
    const handleAliasKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            e.preventDefault();
            onAddAlias();
        }
    };

    return (
        <Flex direction="column" gap="4">
            {/* Top Row: Prompt Name & Model */}
            <Grid columns="2" gap="4">
                <Box>
                    <Text size="2" weight="medium" mb="1" as="div">
                        {t("settings.postProcessing.prompts.promptLabel")}
                    </Text>
                    <TextField.Root
                        variant="surface"
                        value={draftName}
                        onChange={(e) => setDraftName(e.target.value)}
                        placeholder={t("settings.postProcessing.prompts.promptLabelPlaceholder")}
                    />
                </Box>

                <Flex direction="column" className="min-w-0">
                    <Text size="2" weight="medium" mb="1" as="div">
                        {t("settings.postProcessing.api.model.title")}
                    </Text>
                    <Dropdown
                        options={textModels}
                        selectedValue={draftModelId || "default"}
                        onSelect={(val) => setDraftModelId(val === "default" ? null : val)}
                        placeholder={t("common.default")}
                        className="w-full flex-1"
                    />
                </Flex>
            </Grid>

            {/* Second Row: Aliases */}
            <Box>
                <Text size="2" weight="medium" mb="2" as="div">
                    {t("settings.postProcessing.prompts.aliasLabel") || "Alias / Trigger"}
                </Text>

                <TagInput
                    tags={currentAliases}
                    inputValue={currentAliasInput}
                    onInputChange={(val) => {
                        setCurrentAliasInput(val);
                        if (aliasError) setAliasError(null);
                    }}
                    onAdd={onAddAlias}
                    onRemove={onRemoveAlias}
                    onKeyDown={handleAliasKeyDown}
                    placeholder={
                        t("settings.postProcessing.prompts.aliasPlaceholder") ||
                        "Type alias and Enter..."
                    }
                    emptyMessage={
                        t("settings.postProcessing.prompts.noAliases") || "No aliases added"
                    }
                    color="indigo"
                />

                {aliasError && (
                    <Text size="1" color="red" mt="1">
                        {aliasError}
                    </Text>
                )}
            </Box>

            {/* Main Editor */}
            <ResizableEditor
                label={t("settings.postProcessing.prompts.promptInstructions")}
                value={draftContent}
                onChange={setDraftContent}
                placeholder={t("settings.postProcessing.prompts.promptInstructionsPlaceholder")}
                tipKey="settings.postProcessing.prompts.promptTip"
            />
        </Flex>
    );
};
