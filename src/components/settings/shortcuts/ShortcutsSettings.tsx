import { Flex } from "@radix-ui/themes";
import React from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../../hooks/useSettings";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { VotypeShortcut } from "../VotypeShortcut";

export const ShortcutsSettings: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, settings } = useSettings();

  const pushToTalk = getSetting("push_to_talk") || false;
  const debugMode = settings?.debug_mode ?? false;

  return (
    <Flex direction="column" className="max-w-5xl w-full mx-auto space-y-6">
      <SettingsGroup title={t("settings.shortcuts.title")}>
        <VotypeShortcut shortcutId="transcribe" descriptionMode="tooltip" grouped={true} />
        <VotypeShortcut shortcutId="paste_first_entry" descriptionMode="tooltip" grouped={true} />
        <VotypeShortcut shortcutId="open_settings" descriptionMode="tooltip" grouped={true} />
        {debugMode ? (
          <VotypeShortcut
            shortcutId="cancel"
            grouped={true}
            disabled={pushToTalk}
          />
        ) : null}
      </SettingsGroup>
    </Flex>
  );
};

