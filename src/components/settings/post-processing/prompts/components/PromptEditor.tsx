// PromptEditor - Form for editing a single prompt

import { Box } from "@radix-ui/themes";
import { TFunction } from "i18next";
import React from "react";
import { ResizableEditor } from "./ResizableEditor";

interface TextModelOption {
  value: string;
  label: string;
}

interface PromptEditorProps {
  t: TFunction;
  draftContent: string;
  setDraftContent: (value: string) => void;
  onAiLoadingChange?: (loading: boolean) => void;
  skillId?: string;
}

export const PromptEditor: React.FC<PromptEditorProps> = ({
  t,
  draftContent,
  setDraftContent,
  onAiLoadingChange,
  skillId,
}) => {
  return (
    <Box className="h-full">
      <ResizableEditor
        value={draftContent}
        onChange={setDraftContent}
        label={t("settings.postProcessing.prompts.promptBody")}
        tipKey="settings.postProcessing.prompts.promptTip"
        placeholder={t("settings.postProcessing.prompts.promptBodyPlaceholder")}
        className="h-full"
        onAiLoadingChange={onAiLoadingChange}
        skillId={skillId}
      />
    </Box>
  );
};
