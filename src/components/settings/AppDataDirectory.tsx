import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { IconButton, Flex, Text } from "@radix-ui/themes";
import { Copy, Check } from "lucide-react";
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

  return (
    <SettingContainer
      title={t("appData.title")}
      description={t("appData.description")}
      layout="stacked"
      descriptionMode={descriptionMode}
      grouped={grouped}
    >
      <Flex align="center" gap="3">
        <Text className="rounded px-3 py-2 font-mono text-sm break-all flex-1 min-w-0">
          {appDirPath || t("appData.loading")}
        </Text>
        {appDirPath && (
          <IconButton
            size="2"
            variant="ghost"
            color={copied ? "green" : "gray"}
            onClick={handleCopy}
            title={copied ? t("appData.copied") : t("appData.copyPath")}
          >
            {copied ? <Check /> : <Copy />}
          </IconButton>
        )}
      </Flex>
    </SettingContainer>
  );
};
