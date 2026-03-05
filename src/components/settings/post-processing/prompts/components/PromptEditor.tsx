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
}

export const PromptEditor: React.FC<PromptEditorProps> = ({
  t,
  draftContent,
  setDraftContent,
  onAiLoadingChange,
}) => {
  return (
    <Box className="h-full">
      <ResizableEditor
        value={draftContent}
        onChange={setDraftContent}
        label={t("settings.postProcessing.prompts.promptInstructions")}
        tipKey="settings.postProcessing.prompts.promptTip"
        placeholder={t(
          "settings.postProcessing.prompts.promptInstructionsPlaceholder",
        )}
        className="h-full"
        onAiLoadingChange={onAiLoadingChange}
      />
    </Box>
  );
};
