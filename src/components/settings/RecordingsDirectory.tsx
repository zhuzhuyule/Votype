import { Flex, IconButton, Text } from "@radix-ui/themes";
import { IconCheck, IconCopy, IconFolderOpen } from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingContainer } from "../ui/SettingContainer";

interface RecordingsDirectoryProps {
  descriptionMode?: "inline" | "tooltip";
  grouped?: boolean;
}

export const RecordingsDirectory: React.FC<RecordingsDirectoryProps> = ({
  descriptionMode = "tooltip",
  grouped = false,
}) => {
  const { t } = useTranslation();
  const [recordingsPath, setRecordingsPath] = useState<string>("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    invoke<string>("get_recordings_folder_path").then(setRecordingsPath);
  }, []);

  const handleCopy = async () => {
    if (!recordingsPath) return;
    try {
      await navigator.clipboard.writeText(recordingsPath);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const handleOpen = async () => {
    try {
      await invoke("open_recordings_folder");
    } catch (openError) {
      console.error("Failed to open recordings directory:", openError);
    }
  };

  return (
    <SettingContainer
      title={t("settings.about.recordingsDirectory.title")}
      description={t("settings.about.recordingsDirectory.description")}
      layout="stacked"
      descriptionMode={descriptionMode}
      grouped={grouped}
    >
      <Flex align="center" gap="3">
        <Text
          className="rounded px-3 py-2 font-mono text-sm break-all flex-1 min-w-0"
          style={{ backgroundColor: "var(--gray-3, #f3f4f6)" }}
        >
          {recordingsPath || t("common.loading")}
        </Text>
        {recordingsPath && (
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
