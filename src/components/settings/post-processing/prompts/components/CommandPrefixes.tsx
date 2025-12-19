// CommandPrefixes - Component for managing command prefixes

import { TFunction } from "i18next";
import React from "react";
import { SettingContainer } from "../../../../ui/SettingContainer";
import { TagInput } from "./TagInput";

interface CommandPrefixesProps {
  t: TFunction;
  prefixes: string[];
  currentPrefixInput: string;
  setCurrentPrefixInput: (value: string) => void;
  onAddPrefix: () => void;
  onRemovePrefix: (prefix: string) => void;
}

export const CommandPrefixes: React.FC<CommandPrefixesProps> = ({
  t,
  prefixes,
  currentPrefixInput,
  setCurrentPrefixInput,
  onAddPrefix,
  onRemovePrefix,
}) => {
  const handlePrefixKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onAddPrefix();
    }
  };

  return (
    <SettingContainer
      title={t("settings.postProcessing.prompts.commandPrefixTitle")}
      description={t(
        "settings.postProcessing.prompts.commandPrefixDescription",
      )}
      descriptionMode="inline"
      grouped
      layout="stacked"
    >
      <TagInput
        tags={prefixes}
        inputValue={currentPrefixInput}
        onInputChange={setCurrentPrefixInput}
        onAdd={onAddPrefix}
        onRemove={onRemovePrefix}
        onKeyDown={handlePrefixKeyDown}
        placeholder={t(
          "settings.postProcessing.prompts.commandPrefixPlaceholder",
        )}
        emptyMessage={
          t("settings.postProcessing.prompts.noPrefixes") || "No prefixes added"
        }
        color="orange"
      />
    </SettingContainer>
  );
};
