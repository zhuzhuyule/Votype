import { Box, Flex, IconButton, Tabs, Text, Tooltip } from "@radix-ui/themes";
import { IconCopy, IconReload, IconStar, IconTrash } from "@tabler/icons-react";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AudioPlayer } from "../../ui/AudioPlayer";
import type { HistoryEntry } from "./dashboardTypes";

interface DashboardEntryCardProps {
  entry: HistoryEntry;
  getAudioUrl: (fileName: string) => Promise<string | null>;
  metaText: string;
  timeText: string;
  appName: string | null;
  onCopy: (text: string) => void;
  onToggleSaved: (id: number) => void;
  onDelete: (id: number) => void;
  onRetranscribe: (id: number) => Promise<void>;
}

export const DashboardEntryCard = React.memo<DashboardEntryCardProps>(
  ({
    entry,
    getAudioUrl,
    metaText,
    timeText,
    appName,
    onCopy,
    onToggleSaved,
    onDelete,
    onRetranscribe,
  }) => {
    const { t } = useTranslation();
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [audioMissing, setAudioMissing] = useState(false);
    const [activeTab, setActiveTab] = useState<"improved" | "original">("improved");
    const [shouldLoadAudio, setShouldLoadAudio] = useState(false);
    const [retranscribing, setRetranscribing] = useState(false);
    const cardRef = useRef<HTMLDivElement | null>(null);

    const onRetranscribeClick = async () => {
      if (retranscribing) return;
      setRetranscribing(true);
      try {
        await onRetranscribe(entry.id);
      } catch (e) {
        console.error("Retranscribe failed", e);
      } finally {
        setRetranscribing(false);
      }
    };

    useEffect(() => {
      if (!cardRef.current) return;

      const observer = new IntersectionObserver(
        (entries) => {
          if (!entries[0]?.isIntersecting) return;
          setShouldLoadAudio(true);
          observer.disconnect();
        },
        { root: null, rootMargin: "200px", threshold: 0.01 },
      );

      observer.observe(cardRef.current);
      return () => {
        observer.disconnect();
      };
    }, []);

    useEffect(() => {
      let cancelled = false;
      const loadAudio = async () => {
        if (!shouldLoadAudio) return;
        setAudioMissing(false);
        const url = await getAudioUrl(entry.file_name);
        if (cancelled) return;
        setAudioUrl(url);
        setAudioMissing(!url);
      };
      loadAudio();
      return () => {
        cancelled = true;
      };
    }, [entry.file_name, getAudioUrl, shouldLoadAudio]);

    const hasImprovement = !!entry.post_processed_text?.trim();

    return (
      <Box
        ref={cardRef}
        className="bg-background/40 backdrop-blur-md border border-white/10 rounded-xl shadow-sm overflow-hidden"
      >
        <Flex direction="column" className="p-4">
          <Flex justify="between" align="center" className="pb-3">
            <Flex gap="2" align="center" className="flex-wrap">
              <Text size="1" color="gray">
                {timeText}
              </Text>
              {appName ? (
                <Text size="1" color="gray">
                  {appName}
                </Text>
              ) : null}
              {metaText ? (
                <Text size="1" color="gray">
                  {metaText}
                </Text>
              ) : null}
            </Flex>

            <Flex align="center" className="flex gap-5">
              {retranscribing ? (
                <Text size="1" color="gray" className="animate-pulse mr-2">
                  {t("dashboard.actions.retranscribing")}
                </Text>
              ) : null}

              <Tooltip content={t("dashboard.actions.retranscribe")}>
                <IconButton
                  variant="ghost"
                  size="2"
                  disabled={retranscribing}
                  onClick={onRetranscribeClick}
                  className="text-text/60 hover:text-logo-primary hover:bg-logo-primary/10 transition-colors"
                >
                  <IconReload className={`w-4 h-4 ${retranscribing ? "animate-spin" : ""}`} />
                </IconButton>
              </Tooltip>

              <Tooltip content={t("settings.history.copyToClipboard")}>
                <IconButton
                  variant="ghost"
                  size="2"
                  onClick={() => {
                    const text =
                      hasImprovement && activeTab === "improved"
                        ? entry.post_processed_text ?? entry.transcription_text
                        : entry.transcription_text;
                    onCopy(text ?? "");
                  }}
                  className="text-text/60 hover:text-logo-primary hover:bg-logo-primary/10 transition-colors"
                >
                  <IconCopy className="w-4 h-4" />
                </IconButton>
              </Tooltip>

              <Tooltip
                content={
                  entry.saved
                    ? t("settings.history.unsave")
                    : t("settings.history.save")
                }
              >
                <IconButton
                  variant="ghost"
                  size="2"
                  onClick={() => onToggleSaved(entry.id)}
                  className={`transition-colors ${entry.saved
                    ? "text-orange-400 hover:text-orange-500 hover:bg-orange-400/10"
                    : "text-text/60 hover:text-orange-400 hover:bg-orange-400/10"
                    }`}
                >
                  <IconStar className="w-4 h-4" fill={entry.saved ? "currentColor" : "none"} />
                </IconButton>
              </Tooltip>

              <Tooltip content={t("settings.history.delete")}>
                <IconButton
                  variant="ghost"
                  size="2"
                  color="red"
                  onClick={() => onDelete(entry.id)}
                  className="text-text/60 hover:text-red-500 hover:bg-red-500/10 transition-colors"
                >
                  <IconTrash className="w-4 h-4" />
                </IconButton>
              </Tooltip>
            </Flex>
          </Flex>

          {hasImprovement ? (
            <Tabs.Root value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
              <Tabs.List size="1" className="mb-3">
                <Tabs.Trigger value="improved">
                  {t("settings.history.content.improved")}
                </Tabs.Trigger>
                <Tabs.Trigger value="original">
                  {t("settings.history.content.original")}
                </Tabs.Trigger>
              </Tabs.List>
              <Box className="mb-3 bg-mid-gray/5 rounded-lg p-3 border border-mid-gray/10">
                <Tabs.Content value="improved">
                  <Text className="text-text/90 text-sm leading-relaxed whitespace-pre-wrap break-words font-mono">
                    {entry.post_processed_text}
                  </Text>
                </Tabs.Content>
                <Tabs.Content value="original">
                  <Text className="text-text/80 text-sm leading-relaxed whitespace-pre-wrap break-words font-mono">
                    {entry.transcription_text}
                  </Text>
                </Tabs.Content>
              </Box>
            </Tabs.Root>
          ) : (
            <Box className="mb-3 bg-mid-gray/5 rounded-lg p-3 border border-mid-gray/10">
              <Text className="text-text/80 text-sm leading-relaxed whitespace-pre-wrap break-words font-mono">
                {entry.transcription_text}
              </Text>
            </Box>
          )}

          {audioUrl && (
            <Box className="pt-3 border-t border-white/5">
              <AudioPlayer
                src={audioUrl}
                className="w-full"
                onError={() => {
                  setAudioUrl(null);
                  setAudioMissing(true);
                }}
              />
            </Box>
          )}
          {!audioUrl && audioMissing && (
            <Box className="pt-3 border-t border-white/5">
              <Text size="2" color="gray">
                {t("dashboard.details.audioRemoved")}
              </Text>
            </Box>
          )}
        </Flex>
      </Box>
    );
  },
  (prevProps, nextProps) => {
    return (
      prevProps.entry.id === nextProps.entry.id &&
      prevProps.entry.saved === nextProps.entry.saved &&
      prevProps.entry.transcription_text === nextProps.entry.transcription_text &&
      prevProps.entry.post_processed_text === nextProps.entry.post_processed_text
    );
  },
);

DashboardEntryCard.displayName = "DashboardEntryCard";
