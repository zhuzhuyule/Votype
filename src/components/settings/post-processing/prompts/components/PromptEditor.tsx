// PromptEditor - Form for editing a single prompt

import {
  Box,
  Flex,
  Grid,
  Slider as RadixSlider,
  Switch,
  Text,
  TextField,
} from "@radix-ui/themes";
import { TFunction } from "i18next";
import React from "react";
import { IconPicker } from "../../../../shared/IconPicker";
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
  draftIcon: string | null;
  setDraftIcon: (value: string | null) => void;
  currentAliases: string[];
  currentAliasInput: string;
  setCurrentAliasInput: (value: string) => void;
  aliasError: string | null;
  setAliasError: (error: string | null) => void;
  onAddAlias: () => void;
  onRemoveAlias: (alias: string) => void;
  textModels: TextModelOption[];
  draftComplianceCheck: boolean;
  setDraftComplianceCheck: (value: boolean) => void;
  draftComplianceThreshold: number;
  setDraftComplianceThreshold: (value: number) => void;
}

export const PromptEditor: React.FC<PromptEditorProps> = ({
  t,
  draftName,
  setDraftName,
  draftContent,
  setDraftContent,
  draftModelId,
  setDraftModelId,
  draftIcon,
  setDraftIcon,
  currentAliases,
  currentAliasInput,
  setCurrentAliasInput,
  aliasError,
  setAliasError,
  onAddAlias,
  onRemoveAlias,
  textModels,
  draftComplianceCheck,
  setDraftComplianceCheck,
  draftComplianceThreshold,
  setDraftComplianceThreshold,
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
          <Flex gap="2">
            <IconPicker value={draftIcon} onChange={setDraftIcon} />
            <TextField.Root
              variant="surface"
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              placeholder={t(
                "settings.postProcessing.prompts.promptLabelPlaceholder",
              )}
              style={{ flex: 1 }}
            />
          </Flex>
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

      <Flex align="center" gap="4" my="2">
        <Flex align="center" gap="2">
          <Switch
            checked={draftComplianceCheck}
            onCheckedChange={setDraftComplianceCheck}
            size="1"
            style={{ cursor: "pointer" }}
          />
          <Text size="2">
            {t("settings.postProcessing.prompts.enableReview")}
          </Text>
        </Flex>

        {draftComplianceCheck && (
          <Flex align="center" gap="3" style={{ flex: 1, maxWidth: "240px" }}>
            <Text size="2" color="gray">
              {t(
                "settings.postProcessing.confidenceCheck.threshold",
                "Change Threshold",
              )}
            </Text>
            <Box style={{ flex: 1 }}>
              <RadixSlider
                value={[draftComplianceThreshold]}
                onValueChange={(vals: number[]) =>
                  setDraftComplianceThreshold(vals[0])
                }
                min={5}
                max={100}
                step={5}
                size="1"
                style={{ cursor: "pointer" }}
              />
            </Box>
            <Text size="2" style={{ width: "36px", textAlign: "right" }}>
              {Math.round(draftComplianceThreshold)}%
            </Text>
          </Flex>
        )}
      </Flex>

      {/* Main Editor */}
      <ResizableEditor
        label={t("settings.postProcessing.prompts.promptInstructions")}
        fullscreenTitle={draftName}
        value={draftContent}
        onChange={setDraftContent}
        placeholder={t(
          "settings.postProcessing.prompts.promptInstructionsPlaceholder",
        )}
        tipKey="settings.postProcessing.prompts.promptTip"
      />
    </Flex>
  );
};
