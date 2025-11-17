import React, { useState, useEffect, useCallback } from "react";
import { AudioPlayer } from "../../ui/AudioPlayer";
import { Copy, Star, Check, Trash2, FolderOpen } from "lucide-react";
import { Button, Flex, Text, Box } from "@radix-ui/themes";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { SettingsGroup } from "../../ui/SettingsGroup";

interface HistoryEntry {
  id: number;
  file_name: string;
  timestamp: number;
  saved: boolean;
  title: string;
  transcription_text: string;
}

interface OpenRecordingsButtonProps {
  onClick: () => void;
}

const OpenRecordingsButton: React.FC<OpenRecordingsButtonProps> = ({
  onClick,
}) => (
  <Button
    onClick={onClick}
    size="1"
    className="flex items-center gap-2"
    title="Open recordings folder"
  >
    <FolderOpen className="w-4 h-4" />
    <Text>Open Recordings Folder</Text>
  </Button>
);

export const HistorySettings: React.FC = () => {
  const { t } = useTranslation();
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const loadHistoryEntries = useCallback(async () => {
    try {
      const entries = await invoke<HistoryEntry[]>("get_history_entries");
      setHistoryEntries(entries);
    } catch (error) {
      console.error("Failed to load history entries:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistoryEntries();

    // Listen for history update events
    const setupListener = async () => {
      const unlisten = await listen("history-updated", () => {
        console.log("History updated, reloading entries...");
        loadHistoryEntries();
      });

      // Return cleanup function
      return unlisten;
    };

    let unlistenPromise = setupListener();

    return () => {
      unlistenPromise.then((unlisten) => {
        if (unlisten) {
          unlisten();
        }
      });
    };
  }, [loadHistoryEntries]);

  const toggleSaved = async (id: number) => {
    try {
      await invoke("toggle_history_entry_saved", { id });
      // No need to reload here - the event listener will handle it
    } catch (error) {
      console.error("Failed to toggle saved status:", error);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      console.error("Failed to copy to clipboard:", error);
    }
  };

  const getAudioUrl = async (fileName: string) => {
    try {
      const filePath = await invoke<string>("get_audio_file_path", {
        fileName,
      });

      return convertFileSrc(`${filePath}`, "asset");
    } catch (error) {
      console.error("Failed to get audio file path:", error);
      return null;
    }
  };

  const deleteAudioEntry = async (id: number) => {
    try {
      await invoke("delete_history_entry", { id });
    } catch (error) {
      console.error("Failed to delete audio entry:", error);
      throw error;
    }
  };

  const openRecordingsFolder = async () => {
    try {
      await invoke("open_recordings_folder");
    } catch (error) {
      console.error("Failed to open recordings folder:", error);
    }
  };

  if (loading) {
    return (
      <Box className="max-w-3xl w-full mx-auto space-y-6">
        <SettingsGroup title={t("historySettings.title")}>
          <Flex className="px-4 py-3 text-center text-text/60">
            {t("historySettings.loading")}
          </Flex>
        </SettingsGroup>
      </Box>
    );
  }

  if (historyEntries.length === 0) {
    return (
      <Box className="max-w-3xl w-full mx-auto space-y-6">
        <SettingsGroup title={t("historySettings.title")}>
          <Flex className="px-4 py-3 text-center text-text/60">
            {t("historySettings.empty")}
          </Flex>
        </SettingsGroup>
      </Box>
    );
  }

  return (
    <Box className="max-w-3xl w-full mx-auto space-y-6">
      <SettingsGroup title={t("historySettings.title")}>
        {historyEntries.map((entry) => (
          <HistoryEntryComponent
            key={entry.id}
            entry={entry}
            onToggleSaved={() => toggleSaved(entry.id)}
            onCopyText={() => copyToClipboard(entry.transcription_text)}
            getAudioUrl={getAudioUrl}
            deleteAudio={deleteAudioEntry}
          />
        ))}
      </SettingsGroup>
    </Box>
  );
};

interface HistoryEntryProps {
  entry: HistoryEntry;
  onToggleSaved: () => void;
  onCopyText: () => void;
  getAudioUrl: (fileName: string) => Promise<string | null>;
  deleteAudio: (id: number) => Promise<void>;
}

const HistoryEntryComponent: React.FC<HistoryEntryProps> = ({
  entry,
  onToggleSaved,
  onCopyText,
  getAudioUrl,
  deleteAudio,
}) => {
  const { t } = useTranslation();
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [showCopied, setShowCopied] = useState(false);

  useEffect(() => {
    const loadAudio = async () => {
      const url = await getAudioUrl(entry.file_name);
      setAudioUrl(url);
    };
    loadAudio();
  }, [entry.file_name, getAudioUrl]);

  const handleCopyText = () => {
    onCopyText();
    setShowCopied(true);
    setTimeout(() => setShowCopied(false), 2000);
  };

  const handleDeleteEntry = async () => {
    try {
      await deleteAudio(entry.id);
    } catch (error) {
      console.error("Failed to delete entry:", error);
      alert(t("historySettings.deleteError"));
    }
  };

  return (
    <Flex direction="column" gap="3" className="px-4 py-2 pb-5">
      <Flex justify="between" align="center">
        <Text size="2" weight="medium">
          {entry.title}
        </Text>
        <Flex align="center" gap="1">
          <Button
            variant="ghost"
            size="1"
            onClick={handleCopyText}
            className="text-text/50 hover:text-logo-primary hover:border-logo-primary transition-colors cursor-pointer"
            title={t("historySettings.copyTitle")}
          >
            {showCopied ? (
              <Check width={16} height={16} />
            ) : (
              <Copy width={16} height={16} />
            )}
          </Button>
          <Button
            variant="ghost"
            size="1"
            onClick={onToggleSaved}
            className={`p-2 rounded transition-colors cursor-pointer ${
              entry.saved
                ? "text-logo-primary hover:text-logo-primary/80"
                : "text-text/50 hover:text-logo-primary"
            }`}
            title={
              entry.saved
                ? t("historySettings.removeFromSaved")
                : t("historySettings.saveTitle")
            }
          >
            <Star
              width={16}
              height={16}
              fill={entry.saved ? "currentColor" : "none"}
            />
          </Button>
          <Button
            variant="ghost"
            size="1"
            onClick={handleDeleteEntry}
            className="text-text/50 hover:text-logo-primary transition-colors cursor-pointer"
            title={t("historySettings.deleteTitle")}
          >
            <Trash2 width={16} height={16} />
          </Button>
        </Flex>
      </Flex>
      <Text className="italic text-text/90 text-sm pb-2">
        {entry.transcription_text}
      </Text>
      {audioUrl && <AudioPlayer src={audioUrl} className="w-full" />}
    </Flex>
  );
};
