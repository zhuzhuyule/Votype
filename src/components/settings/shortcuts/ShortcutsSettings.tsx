import { Flex } from "@radix-ui/themes";
import React from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../../hooks/useSettings";
import { SettingsGroup } from "../../ui/SettingsGroup";
import { VotypeShortcut } from "../VotypeShortcut";

export const ShortcutsSettings: React.FC = () => {
  const { t } = useTranslation();
  const { getSetting, settings } = useSettings();

  const activationMode = getSetting("activation_mode") || "toggle";
  const debugMode = settings?.debug_mode ?? false;

  return (
    <Flex direction="column" className="max-w-5xl w-full mx-auto space-y-8">
      <SettingsGroup title={t("settings.shortcuts.title")}>
        <VotypeShortcut
          shortcutId="transcribe"
          descriptionMode="inline"
          grouped={true}
        />
        <VotypeShortcut
          shortcutId="transcribe_with_post_process"
          descriptionMode="inline"
          grouped={true}
        />
        <VotypeShortcut
          shortcutId="invoke_skill"
          descriptionMode="inline"
          grouped={true}
        />
        <VotypeShortcut
          shortcutId="paste_first_entry"
          descriptionMode="inline"
          grouped={true}
        />
        <VotypeShortcut
          shortcutId="open_settings"
          descriptionMode="inline"
          grouped={true}
        />
        {debugMode ? (
          <VotypeShortcut
            shortcutId="cancel"
            descriptionMode="inline"
            grouped={true}
            disabled={activationMode === "hold"}
          />
        ) : null}
      </SettingsGroup>
    </Flex>
  );
};
