import { Flex, IconButton, Text } from "@radix-ui/themes";
import { IconCheck, IconCopy, IconFolderOpen } from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingContainer } from "../ui/SettingContainer";

interface AppDataDirectoryProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const AppDataDirectory: React.FC<AppDataDirectoryProps> = ({
  descriptionMode = "tooltip",
  grouped = false,
}) => {
  const { t } = useTranslation();
  const [appDirPath, setAppDirPath] = useState<string>("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    invoke<string>("get_app_dir_path").then(setAppDirPath);
  }, []);

  const handleCopy = async () => {
    if (!appDirPath) return;
    try {
      await navigator.clipboard.writeText(appDirPath);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const handleOpen = async () => {
    if (!appDirPath) return;
    try {
      await invoke("open_app_data_dir");
    } catch (openError) {
      console.error("Failed to open app data directory:", openError);
    }
  };

  return (
    <SettingContainer
      title={t("settings.about.appDataDirectory.title")}
      description={t("settings.about.appDataDirectory.description")}
      layout="stacked"
      descriptionMode={descriptionMode}
      grouped={grouped}
    >
      <Flex align="center" gap="3">
        <Text
          className="rounded px-3 py-2 font-mono text-sm break-all flex-1 min-w-0"
          style={{ backgroundColor: "var(--gray-3, #f3f4f6)" }}
        >
          {appDirPath || t("common.loading")}
        </Text>
        {appDirPath && (
          <>
            <IconButton
              size="2"
              variant="ghost"
              color={copied ? "green" : "gray"}
              onClick={handleCopy}
              title={copied ? t("common.copied") : t("common.copy")}
            >
              {copied ? <IconCheck /> : <IconCopy />}
            </IconButton>
            <IconButton
              onClick={handleOpen}
              size="2"
              variant="ghost"
              disabled={!appDirPath}
              title={t("common.open")}
            >
              <IconFolderOpen />
            </IconButton>
          </>
        )}
      </Flex>
    </SettingContainer>
  );
};
