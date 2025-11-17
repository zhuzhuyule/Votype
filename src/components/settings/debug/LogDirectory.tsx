import { Flex, IconButton, Text } from "@radix-ui/themes";
import { FolderOpen } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingContainer } from "../../ui/SettingContainer";

interface LogDirectoryProps {
  descriptionMode?: "tooltip" | "inline";
  grouped?: boolean;
}

export const LogDirectory: React.FC<LogDirectoryProps> = ({
  descriptionMode = "tooltip",
  grouped = false,
}) => {
  const { t } = useTranslation();
  const [logDir, setLogDir] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadLogDirectory = async () => {
      try {
        const result = await invoke<string>("get_log_dir_path");
        setLogDir(result);
      } catch (err) {
        const errorMessage =
          err && typeof err === "object" && "message" in err
            ? String(err.message)
            : "Failed to load log directory";
        setError(errorMessage);
      } finally {
        setLoading(false);
      }
    };

    loadLogDirectory();
  }, []);

  const handleOpen = async () => {
    if (!logDir) return;
    try {
      await invoke("open_log_dir");
    } catch (openError) {
      console.error("Failed to open log directory:", openError);
    }
  };

  return (
    <SettingContainer
      title={t("logDirectory.title")}
      description={t("logDirectory.description")}
      descriptionMode={descriptionMode}
      grouped={grouped}
      layout="stacked"
    >
      {loading ? (
        <div className="animate-pulse">
          <div className="h-8 bg-gray-100 rounded" />
        </div>
      ) : error ? (
        <div className="p-3 bg-red-50 border border-red-200 rounded text-xs text-red-600">
          {t("logDirectory.error", { error })}
        </div>
      ) : (
        <Flex align="center" gap="3">
          <Text
            className="rounded px-3 py-2 font-mono text-sm break-all flex-1 min-w-0"
            style={{ backgroundColor: "var(--gray-3, #f3f4f6)" }}
          >
            {logDir}
          </Text>
          {logDir && (
            <IconButton
              onClick={handleOpen}
              size="2"
              variant="ghost"
              title={t("logDirectory.open")}
            >
              <FolderOpen />
            </IconButton>
          )}
        </Flex>
      )}
    </SettingContainer>
  );
};
