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
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../../hooks/useSettings";
import { DynamicIcon } from "../../shared/IconPicker";
import { AudioPlayer } from "../../ui/AudioPlayer";
import { Card } from "../../ui/Card";
import type { HistoryEntry, PostProcessStep } from "./dashboardTypes";

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
    const [activeTab, setActiveTab] = useState<string>("original");

    const [retranscribing, setRetranscribing] = useState(false);
    const [reprocessing, setReprocessing] = useState(false);

    const historySteps = useMemo(() => {
      if (!entry.post_process_history) return [];
      try {
        return JSON.parse(entry.post_process_history) as PostProcessStep[];
      } catch (e) {
        console.error("Failed to parse post_process_history", e);
        return [];
      }
    }, [entry.post_process_history]);

    const hasSteps = historySteps.length > 0;
    const hasImprovement = !!entry.post_processed_text?.trim() && !hasSteps;
    const hasStreaming = !!entry.streaming_text?.trim();

    const finalStepIdx = hasSteps ? historySteps.length - 1 : -1;
    const intermediateSteps = hasSteps ? historySteps.slice(0, -1) : [];

    // Auto-reset tab to the first/best one when entry changes or gets processed
    useEffect(() => {
      if (hasSteps) {
        setActiveTab(`step:${finalStepIdx}`);
      } else if (hasImprovement) {
        setActiveTab("improved");
      } else {
        setActiveTab("original");
      }
    }, [entry.id, hasImprovement, hasSteps, historySteps.length]);

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

    const onReprocessClick = async (promptId: string) => {
      console.log(
        `[DashboardEntryCard] onReprocessClick triggered for entry: ${entry.id}, prompt: ${promptId}`,
      );
      if (reprocessing) return;
      setReprocessing(true);
      try {
        await onReprocess(entry.id, promptId);
      } catch (e) {
        console.error("[DashboardEntryCard] Reprocess failed", e);
      } finally {
        setReprocessing(false);
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
              {(entry.streaming_asr_model || hasImprovement || hasSteps) && (
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

                  {(hasImprovement || hasSteps) && (
                    <>
                      <Text size="1" className="opacity-30">
                        →
                      </Text>
                      <Tooltip
                        content={
                          hasSteps
                            ? `${t("settings.history.content.chained")}: ${historySteps.length} steps`
                            : `AI: ${entry.post_process_model || "Unknown"}`
                        }
                      >
                        <Flex gap="1" align="center">
                          <DynamicIcon
                            name={improvedTabIcon}
                            size={12}
                            className="text-logo-primary opacity-80"
                          />
                          {hasSteps && historySteps.length > 1 && (
                            <Text size="1" color="iris" weight="bold">
                              {historySteps.length}
                            </Text>
                          )}
                        </Flex>
                      </Tooltip>
                    </>
                  )}
                </Flex>
              )}

              <Flex gap="1" align="center">
                <Text size="1" color="gray" weight="medium">
                  {appName || t("common.unknown")}
                </Text>
                {entry.window_title && entry.window_title !== appName && (
                  <>
                    <Text size="1" color="gray" className="opacity-40">
                      ·
                    </Text>
                    <Tooltip content={entry.window_title}>
                      <Text
                        size="1"
                        color="gray"
                        className="max-w-[180px] truncate opacity-70"
                      >
                        {entry.window_title}
                      </Text>
                    </Tooltip>
                  </>
                )}
              </Flex>
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
                    if (activeTab.startsWith("step:")) {
                      const idx = parseInt(activeTab.split(":")[1]);
                      text =
                        historySteps[idx]?.result ?? entry.transcription_text;
                    } else if (activeTab === "improved") {
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
              <Tabs.List size="1" className="flex-wrap gap-y-1 mb-3">
                {/* 1. Final Step (Most important) */}
                {hasSteps && (
                  <Tabs.Trigger value={`step:${finalStepIdx}`}>
                    <Flex align="center" gap="2">
                      <DynamicIcon
                        name={
                          (historySteps[finalStepIdx].prompt_id &&
                            settings?.post_process_prompts.find(
                              (p) =>
                                p.id === historySteps[finalStepIdx].prompt_id,
                            )?.icon) ||
                          "IconWand"
                        }
                        size={14}
                      />
                      {historySteps[finalStepIdx].prompt_name}
                    </Flex>
                  </Tabs.Trigger>
                )}
                {hasImprovement && (
                  <Tabs.Trigger value="improved">
                    <Flex align="center" gap="2">
                      <DynamicIcon name={improvedTabIcon} size={14} />
                      {improvedTabLabel}
                    </Flex>
                  </Tabs.Trigger>
                )}

                {/* 2. Original Transcription (Comparison base) */}
                <Tabs.Trigger value="original">
                  {t("settings.history.content.original")}
                </Tabs.Trigger>

                {/* 3. Streaming (If exists) */}
                {hasStreaming && (
                  <Tabs.Trigger value="streaming">
                    {t("settings.history.content.streaming")}
                  </Tabs.Trigger>
                )}

                {/* 4. Intermediate Steps (Process audit) */}
                {intermediateSteps.map((step, idx) => (
                  <Tabs.Trigger key={idx} value={`step:${idx}`}>
                    <Flex align="center" gap="2">
                      <DynamicIcon
                        name={
                          (step.prompt_id &&
                            settings?.post_process_prompts.find(
                              (p) => p.id === step.prompt_id,
                            )?.icon) ||
                          "IconWand"
                        }
                        size={14}
                      />
                      {step.prompt_name}
                    </Flex>
                  </Tabs.Trigger>
                ))}
              </Tabs.List>
              <Box className="mb-3 bg-mid-gray/5 rounded-lg p-3 border border-mid-gray/10">
                {hasSteps &&
                  historySteps.map((step, idx) => (
                    <Tabs.Content key={idx} value={`step:${idx}`}>
                      <Flex direction="column" gap="2">
                        <Text className="text-text/90 text-sm leading-relaxed whitespace-pre-wrap wrap-break-word font-mono">
                          {step.result}
                        </Text>
                        <Flex
                          justify="end"
                          align="center"
                          gap="2"
                          className="mt-1 opacity-50"
                        >
                          <Text size="1">Model: {step.model || "Unknown"}</Text>
                        </Flex>
                      </Flex>
                    </Tabs.Content>
                  ))}
                <Tabs.Content value="improved">
                  <Text className="text-text/90 text-sm leading-relaxed whitespace-pre-wrap wrap-break-word font-mono">
                    {entry.post_processed_text}
                  </Text>
                </Tabs.Content>
                <Tabs.Content value="original">
                  <Text className="text-text/80 text-sm leading-relaxed whitespace-pre-wrap wrap-break-word font-mono">
                    {entry.transcription_text}
                  </Text>
                </Tabs.Content>
                <Tabs.Content value="streaming">
                  <Text className="text-text/80 text-sm leading-relaxed whitespace-pre-wrap wrap-break-word font-mono italic">
                    {entry.streaming_text}
                  </Text>
                </Tabs.Content>
              </Box>
            </Tabs.Root>
          ) : (
            <Box className="mb-3 bg-mid-gray/5 rounded-lg p-3 border border-mid-gray/10">
              <Text className="text-text/80 text-sm leading-relaxed whitespace-pre-wrap wrap-break-word font-mono">
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
