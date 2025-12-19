import {
  Box,
  DropdownMenu,
  Flex,
  IconButton,
  Tabs,
  Text,
  Tooltip,
} from "@radix-ui/themes";
import {
  IconCopy,
  IconMicrophone,
  IconPlayerPlay,
  IconStar,
  IconTrash,
  IconWand,
} from "@tabler/icons-react";
import React, { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../../hooks/useSettings";
import { DynamicIcon } from "../../shared/IconPicker";
import { AudioPlayer } from "../../ui/AudioPlayer";
import { Card } from "../../ui/Card";
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
  onReprocess: (
    id: number,
    promptId: string,
    inputText?: string,
  ) => Promise<void>;
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
    onReprocess,
  }) => {
    const { t } = useTranslation();
    const { settings } = useSettings();
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [audioMissing, setAudioMissing] = useState(false);
    const [isLoadingAudio, setIsLoadingAudio] = useState(false);
    const [shouldAutoPlay, setShouldAutoPlay] = useState(false);
    const [activeTab, setActiveTab] = useState<
      "improved" | "original" | "streaming"
    >(entry.post_processed_text?.trim() ? "improved" : "original");
    const [retranscribing, setRetranscribing] = useState(false);
    const [reprocessing, setReprocessing] = useState(false);

    const onReprocessClick = async (promptId: string) => {
      console.log(
        `[DashboardEntryCard] onReprocessClick triggered for prompt: ${promptId}`,
      );
      if (reprocessing) return;

      // Logic: Pick text from the currently active tab
      let inputText = entry.transcription_text;
      if (activeTab === "improved") {
        inputText = entry.post_processed_text ?? entry.transcription_text;
      } else if (activeTab === "streaming") {
        inputText = entry.streaming_text ?? entry.transcription_text;
      }

      console.log(
        `[DashboardEntryCard] Processing with input: ${inputText?.substring(0, 50)}...`,
      );

      setReprocessing(true);
      try {
        await onReprocess(entry.id, promptId, inputText ?? undefined);
        setActiveTab("improved");
      } catch (e) {
        console.error("[DashboardEntryCard] Reprocess failed", e);
      } finally {
        setReprocessing(false);
      }
    };

    const onRetranscribeClick = async () => {
      console.log(
        `[DashboardEntryCard] onRetranscribeClick triggered for entry: ${entry.id}`,
      );
      if (retranscribing) return;
      setRetranscribing(true);
      try {
        await onRetranscribe(entry.id);
      } catch (e) {
        console.error("[DashboardEntryCard] Retranscribe failed", e);
      } finally {
        setRetranscribing(false);
      }
    };

    // Load audio only when requested (on play click)
    const loadAudio = useCallback(async () => {
      if (audioUrl || isLoadingAudio) return; // Already loaded or loading
      setIsLoadingAudio(true);
      setAudioMissing(false);
      try {
        const url = await getAudioUrl(entry.file_name);
        if (url) {
          setAudioUrl(url);
          setShouldAutoPlay(true); // Auto-play after loading
        } else {
          setAudioMissing(true);
        }
      } finally {
        setIsLoadingAudio(false);
      }
    }, [audioUrl, isLoadingAudio, entry.file_name, getAudioUrl]);

    const hasImprovement = !!entry.post_processed_text?.trim();
    const hasStreaming = !!entry.streaming_text?.trim();

    // Logic: Find the prompt object used for this entry
    const usedPrompt = useMemo(() => {
      // 1. Try matching by ID first (Most reliable and dynamic)
      if (entry.post_process_prompt_id) {
        const found = settings?.post_process_prompts.find(
          (p) => p.id === entry.post_process_prompt_id,
        );
        if (found) return found;
      }

      // 2. Fallback to matching by prompt text (for old entries or deleted prompts)
      if (entry.post_process_prompt) {
        return settings?.post_process_prompts.find(
          (p) => p.prompt === entry.post_process_prompt,
        );
      }
      return null;
    }, [
      entry.post_process_prompt_id,
      entry.post_process_prompt,
      settings?.post_process_prompts,
    ]);

    const improvedTabLabel =
      usedPrompt?.name || t("settings.history.content.improved");
    const improvedTabIcon = usedPrompt?.icon || "IconWand";

    // Format duration from entry.duration_ms
    const formatDuration = (ms: number) => {
      const totalSeconds = Math.floor(ms / 1000);
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      return `${minutes}:${seconds.toString().padStart(2, "0")}`;
    };

    const durationText = entry.duration_ms
      ? formatDuration(entry.duration_ms)
      : null;

    const availablePrompts = settings?.post_process_prompts || [];

    return (
      <Card className="px-1 py-0.5 border-mid-gray/20 border-1" shadow="none">
        <Flex direction="column" className="p-4">
          <Flex justify="between" align="center" className="pb-3">
            <Flex gap="2" align="center" className="flex-wrap">
              <Text size="1" color="gray">
                {timeText}
              </Text>

              {/* Processing Chain Badges - Only shown if step count > 1 */}
              {(entry.streaming_asr_model || hasImprovement) && (
                <Flex
                  gap="1"
                  align="center"
                  className="bg-mid-gray/10 px-1.5 py-0.5 rounded border border-mid-gray/10"
                >
                  <Tooltip content={`ASR: ${entry.asr_model}`}>
                    <IconMicrophone size={12} className="opacity-60" />
                  </Tooltip>

                  {entry.streaming_asr_model && (
                    <>
                      <Text size="1" className="opacity-30">
                        /
                      </Text>
                      <Tooltip
                        content={`Streaming: ${entry.streaming_asr_model}`}
                      >
                        <Box className="w-1.5 h-1.5 rounded-full bg-logo-primary/60 animate-pulse" />
                      </Tooltip>
                    </>
                  )}

                  {hasImprovement && (
                    <>
                      <Text size="1" className="opacity-30">
                        →
                      </Text>
                      <Tooltip
                        content={`AI: ${entry.post_process_model || "Unknown"}`}
                      >
                        <DynamicIcon
                          name={improvedTabIcon}
                          size={12}
                          className="text-logo-primary opacity-80"
                        />
                      </Tooltip>
                    </>
                  )}
                </Flex>
              )}

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

            <Flex align="center" className="flex gap-4">
              {retranscribing || reprocessing ? (
                <Text size="1" color="gray" className="animate-pulse mr-2">
                  {t("common.loading")}
                </Text>
              ) : null}

              <DropdownMenu.Root>
                <DropdownMenu.Trigger disabled={retranscribing || reprocessing}>
                  <IconButton
                    variant="ghost"
                    size="2"
                    className="text-text/60 hover:text-logo-primary hover:bg-logo-primary/10 transition-colors"
                  >
                    <IconWand
                      className={`w-4 h-4 ${reprocessing ? "animate-pulse" : ""}`}
                    />
                  </IconButton>
                </DropdownMenu.Trigger>
                <DropdownMenu.Content variant="soft" color="gray" size="2">
                  {availablePrompts.map((p) => (
                    <DropdownMenu.Item
                      key={p.id}
                      onClick={() => {
                        console.log(
                          `[UI] Clicked prompt item: ${p.name} (${p.id})`,
                        );
                        onReprocessClick(p.id);
                      }}
                      className="cursor-pointer"
                    >
                      <DynamicIcon
                        name={p.icon || "IconWand"}
                        size={14}
                        className="mr-2 opacity-70"
                      />
                      {p.name}
                    </DropdownMenu.Item>
                  ))}{" "}
                  <DropdownMenu.Item
                    color="red"
                    onClick={() => {
                      console.log("[UI] Clicked retranscribe item");
                      onRetranscribeClick();
                    }}
                    className="cursor-pointer"
                  >
                    {t("dashboard.actions.retranscribe")}
                  </DropdownMenu.Item>
                </DropdownMenu.Content>{" "}
              </DropdownMenu.Root>

              <Tooltip content={t("settings.history.copyToClipboard")}>
                <IconButton
                  variant="ghost"
                  size="2"
                  onClick={() => {
                    let text = entry.transcription_text;
                    if (activeTab === "improved") {
                      text =
                        entry.post_processed_text ?? entry.transcription_text;
                    } else if (activeTab === "streaming") {
                      text = entry.streaming_text ?? entry.transcription_text;
                    }
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
                  className={`transition-colors ${
                    entry.saved
                      ? "text-orange-400 hover:text-orange-500 hover:bg-orange-400/10"
                      : "text-text/60 hover:text-orange-400 hover:bg-orange-400/10"
                  }`}
                >
                  <IconStar
                    className="w-4 h-4"
                    fill={entry.saved ? "currentColor" : "none"}
                  />
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

          {hasImprovement || hasStreaming ? (
            <Tabs.Root
              value={activeTab}
              onValueChange={(v) => setActiveTab(v as any)}
            >
              <Tabs.List size="1" className="mb-3">
                {hasImprovement && (
                  <Tabs.Trigger value="improved">
                    <Flex align="center" gap="2">
                      <DynamicIcon name={improvedTabIcon} size={14} />
                      {improvedTabLabel}
                    </Flex>
                  </Tabs.Trigger>
                )}
                <Tabs.Trigger value="original">
                  {t("settings.history.content.original")}
                </Tabs.Trigger>
                {hasStreaming && (
                  <Tabs.Trigger value="streaming">
                    {t("settings.history.content.streaming")}
                  </Tabs.Trigger>
                )}
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
                <Tabs.Content value="streaming">
                  <Text className="text-text/80 text-sm leading-relaxed whitespace-pre-wrap break-words font-mono italic">
                    {entry.streaming_text}
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

          {/* Audio section */}
          {audioUrl ? (
            <Box className="pt-3 border-t border-white/5">
              <AudioPlayer
                src={audioUrl}
                autoPlay={shouldAutoPlay}
                className="w-full"
                onError={() => {
                  setAudioUrl(null);
                  setAudioMissing(true);
                }}
              />
            </Box>
          ) : audioMissing ? (
            <Box className="pt-3 border-t border-white/5">
              <Text size="2" color="gray">
                {t("dashboard.details.audioRemoved")}
              </Text>
            </Box>
          ) : durationText ? (
            <Box className="pt-3 border-t border-white/5">
              <Flex align="center" gap="3">
                <IconButton
                  variant="ghost"
                  size="2"
                  onClick={loadAudio}
                  disabled={isLoadingAudio}
                  className="text-text/60 hover:text-logo-primary hover:bg-logo-primary/10 transition-colors"
                >
                  <IconPlayerPlay
                    className={`w-4 h-4 ${isLoadingAudio ? "animate-pulse" : ""}`}
                  />
                </IconButton>
                <Box className="flex-1 h-2 bg-mid-gray/15 rounded" />
                <Text size="1" color="gray">
                  {durationText}
                </Text>
              </Flex>
            </Box>
          ) : null}
        </Flex>
      </Card>
    );
  },
  (prevProps, nextProps) => {
    return (
      prevProps.entry.id === nextProps.entry.id &&
      prevProps.entry.saved === nextProps.entry.saved &&
      prevProps.entry.transcription_text ===
        nextProps.entry.transcription_text &&
      prevProps.entry.post_processed_text ===
        nextProps.entry.post_processed_text &&
      prevProps.entry.streaming_text === nextProps.entry.streaming_text
    );
  },
);

DashboardEntryCard.displayName = "DashboardEntryCard";
