import { Badge, Box, Button, Flex, IconButton, ScrollArea, Tabs, Text, TextField, Tooltip } from "@radix-ui/themes";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Clock, Copy, FolderOpen, Search, Star, Trash2 } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { AudioPlayer } from "../../ui/AudioPlayer";

interface HistoryEntry {
  id: number;
  file_name: string;
  timestamp: number;
  saved: boolean;
  title: string;
  transcription_text: string;
  post_processed_text?: string;
  post_process_prompt?: string;
  duration_ms?: number;
  char_count?: number;
  corrected_char_count?: number;
}

const formatDate = (timestamp: number) => {
  const date = new Date(timestamp * 1000);
  const fullDate = date.toLocaleDateString();
  const fullTime = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  
  let relativeTime = '';
  if (diff < 60 * 60 * 1000) {
    const minutes = Math.max(1, Math.floor(diff / (60 * 1000)));
    relativeTime = `${minutes}m ago`;
  } else if (diff < 24 * 60 * 60 * 1000) {
    const hours = Math.floor(diff / (60 * 60 * 1000));
    relativeTime = `${hours}h ago`;
  } else if (diff < 7 * 24 * 60 * 60 * 1000) {
    const days = Math.floor(diff / (24 * 60 * 60 * 1000));
    relativeTime = `${days}d ago`;
  } else {
    relativeTime = fullDate;
  }

  return { fullDate, fullTime, relativeTime };
};

type TimeGroup = "today" | "yesterday" | "thisWeek" | "earlier";

export const HistorySettings: React.FC = () => {
  const { t } = useTranslation();
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [displayCount, setDisplayCount] = useState(20);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const observerTarget = React.useRef<HTMLDivElement>(null);

  // Debounce search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);



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

    const setupListener = async () => {
      const unlisten = await listen("history-updated", () => {
        loadHistoryEntries();
      });
      return unlisten;
    };

    let unlistenPromise = setupListener();

    return () => {
      unlistenPromise.then((unlisten) => {
        if (unlisten) unlisten();
      });
    };
  }, [loadHistoryEntries]);

  const { groups, counts, filteredTotal } = useMemo(() => {
    const groups: Record<TimeGroup, HistoryEntry[]> = {
      today: [],
      yesterday: [],
      thisWeek: [],
      earlier: [],
    };
    
    const counts: Record<TimeGroup, number> = {
      today: 0,
      yesterday: 0,
      thisWeek: 0,
      earlier: 0,
    };

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterdayStart = todayStart - 24 * 60 * 60 * 1000;
    const weekStart = todayStart - 6 * 24 * 60 * 60 * 1000;

    // 1. Filter entries
    const filteredEntries = historyEntries.filter(entry => {
      if (!debouncedSearchQuery) return true;
      const lowerCaseDebouncedQuery = debouncedSearchQuery.toLowerCase();
      return (
        entry.transcription_text?.toLowerCase().includes(lowerCaseDebouncedQuery) ||
        entry.post_processed_text?.toLowerCase().includes(lowerCaseDebouncedQuery)
      );
    });

    // 2. Calculate counts and distribute to groups
    filteredEntries.forEach((entry) => {
      const entryTime = entry.timestamp * 1000;
      if (entryTime >= todayStart) {
        counts.today++;
      } else if (entryTime >= yesterdayStart) {
        counts.yesterday++;
      } else if (entryTime >= weekStart) {
        counts.thisWeek++;
      } else {
        counts.earlier++;
      }
    });

    // 3. Slice for display
    const entriesToDisplay = filteredEntries.slice(0, displayCount);

    entriesToDisplay.forEach((entry) => {
      const entryTime = entry.timestamp * 1000;
      if (entryTime >= todayStart) {
        groups.today.push(entry);
      } else if (entryTime >= yesterdayStart) {
        groups.yesterday.push(entry);
      } else if (entryTime >= weekStart) {
        groups.thisWeek.push(entry);
      } else {
        groups.earlier.push(entry);
      }
    });

    return { groups, counts, filteredTotal: filteredEntries.length };
  }, [historyEntries, displayCount, debouncedSearchQuery]);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && displayCount < filteredTotal) {
          setDisplayCount((prev) => Math.min(prev + 20, filteredTotal));
        }
      },
      { threshold: 0.1 }
    );

    if (observerTarget.current) {
      observer.observe(observerTarget.current);
    }

    return () => observer.disconnect();
  }, [displayCount, filteredTotal]);

  const toggleSaved = async (id: number) => {
    try {
      await invoke("toggle_history_entry_saved", { id });
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
      const filePath = await invoke<string>("get_audio_file_path", { fileName });
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
      <Box className="h-full p-6">
        <Flex justify="center" align="center" className="h-full text-text/40">
          <Text>{t("historySettings.loading")}</Text>
        </Flex>
      </Box>
    );
  }

  if (historyEntries.length === 0) {
    return (
      <Box className="max-w-4xl w-full mx-auto p-6">
        <Flex justify="between" align="center" mb="6">
          <Text size="5" weight="bold" className="text-text">{t("historySettings.title")}</Text>
          <Button variant="soft" onClick={openRecordingsFolder}>
            <FolderOpen className="w-4 h-4 mr-2" />
            {t("historySettings.openFolder")}
          </Button>
        </Flex>
        <Flex direction="column" align="center" justify="center" className="py-20 text-text/40">
          <Clock className="w-12 h-12 mb-4 opacity-20" />
          <Text>{t("historySettings.empty")}</Text>
        </Flex>
      </Box>
    );
  }

  return (
    <Box className="max-w-4xl w-full mx-auto p-6">
      <Flex justify="between" align="center" mb="6" className="pr-9">
        <Flex align="center" gap="3">
          <Text size="5" weight="bold" className="text-text">{t("historySettings.title")}</Text>
          <Badge variant="soft" color="gray" radius="full">
            {filteredTotal}
          </Badge>
        </Flex>
        
        <Flex gap="3">
          <TextField.Root 
            placeholder={t("historySettings.searchPlaceholder")} 
            value={searchQuery}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
            className="w-64"
          >
            <TextField.Slot>
              <Search height="14" width="14" />
            </TextField.Slot>
          </TextField.Root>

          <Tooltip content={t("historySettings.openFolder")}>
            <IconButton variant="surface" className="cursor-pointer" onClick={openRecordingsFolder} >
              <FolderOpen size="16" />
            </IconButton>
          </Tooltip>
        </Flex>
      </Flex>

      <ScrollArea 
        type="hover" 
        scrollbars="vertical" 
        className="h-[calc(100vh-12rem)] pr-4"
      >
        <Box className="relative">
          {/* Continuous vertical timeline line - drawn once for entire timeline */}
          {(() => {
            const groupKeys = Object.keys(groups) as TimeGroup[];
            return groupKeys.map((group, groupIndex) => {
              const entries = groups[group];
              if (entries.length === 0) return null;

              return (
                <Box key={group} className="relative">
                  {/* Date Group Header */}
                  <Flex 
                    gap="4" 
                    className={`relative pb-4 pointer-events-none ${groupIndex === 0 ? '' : 'pt-8'}`}
                  >
                    {/* Left: Sticky Header Text */}
                    <Box className="w-24 flex-shrink-0 text-right">
                      <Text 
                        size="2" 
                        weight="bold" 
                        className="sticky top-0 z-20 block text-logo-primary py-2 pointer-events-auto"
                      >
                        {t(`historySettings.timeline.${group}`)}
                        <Text className="pl-1 opacity-60 text-xs font-normal">
                          ({counts[group]})
                        </Text>
                      </Text>
                    </Box>

                    {/* Middle: Timeline Line */}
                    <Box className="relative flex-shrink-0 w-2">
                      <Box 
                        className={`absolute left-1/2 -translate-x-1/2 w-[2px] bg-mid-gray/20 -bottom-4 ${
                          groupIndex > 0 ? '-top-8' : 'top-0'
                        }`} 
                      />
                    </Box>
                  </Flex>

                  {/* Entries */}
                  {entries.map((entry, entryIndex) => {
                    const dateInfo = formatDate(entry.timestamp);
                    const prevEntry = entryIndex > 0 ? entries[entryIndex - 1] : null;
                    const prevDateInfo = prevEntry ? formatDate(prevEntry.timestamp) : null;
                    const showFullDate = !prevDateInfo || prevDateInfo.fullDate !== dateInfo.fullDate;
                    
                    const isLastGroup = groupIndex === groupKeys.length - 1;
                    const isLastEntry = isLastGroup && entryIndex === entries.length - 1;

                    return (
                      <Flex key={entry.id} gap="4" className="relative pb-6">
                        {/* Left: Date/Time */}
                        <Box className="w-24 flex-shrink-0 text-right pt-1" title={`${dateInfo.fullDate} ${dateInfo.fullTime}`}>
                          {showFullDate && (
                            <Text size="1" className="text-text/60 block leading-tight">
                              {dateInfo.fullDate}
                            </Text>
                          )}
                          <Text size="1" className="text-text/60 block leading-tight">
                            {dateInfo.fullTime}
                          </Text>
                          <Text size="1" className="text-text/40 block mt-1">
                            {dateInfo.relativeTime}
                          </Text>
                        </Box>

                        {/* Timeline Dot and Line */}
                        <Box className="relative flex-shrink-0">
                          {/* Vertical line - spans full height of entry including padding */}
                          <Box 
                            className={`absolute left-1/2 -translate-x-1/2 top-0 w-[2px] bg-mid-gray/20 -z-10 ${
                              isLastEntry ? 'bottom-0' : '-bottom-6'
                            }`} 
                          />
                          {/* Dot */}
                          <Box className="w-2 h-2 rounded-full bg-logo-primary/60 border-2 border-background relative z-10" />
                        </Box>

                        {/* Right: Entry Card and Actions */}
                        <Box className="flex-1 min-w-0 relative group z-1">
                          <Flex gap="2">
                            <Box className="flex-1 min-w-0">
                            <HistoryEntryComponent
                              entry={entry}
                              getAudioUrl={getAudioUrl}
                            />
                          </Box>

                          {/* Action Buttons - Vertical on the right, larger size */}
                          <Flex direction="column" gap="1" className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 pt-1 relative z-10">
                            <IconButton
                              variant="ghost"
                              size="2"
                              onClick={() => {
                                const textToCopy = entry.post_processed_text || entry.transcription_text;
                                copyToClipboard(textToCopy);
                              }}
                              className="text-text/50 hover:text-logo-primary hover:bg-logo-primary/10 transition-colors"
                              title={t("historySettings.copyTitle")}
                            >
                              <Copy className="w-4 h-4" />
                            </IconButton>
                            <IconButton
                              variant="ghost"
                              size="2"
                              onClick={() => toggleSaved(entry.id)}
                              className={`transition-colors ${
                                entry.saved ? "text-orange-400 hover:text-orange-500 hover:bg-orange-400/10" : "text-text/50 hover:text-orange-400 hover:bg-orange-400/10"
                              }`}
                              title={entry.saved ? t("historySettings.removeFromSaved") : t("historySettings.saveTitle")}
                            >
                              <Star className="w-4 h-4" fill={entry.saved ? "currentColor" : "none"} />
                            </IconButton>
                            <IconButton
                              variant="ghost"
                              size="2"
                              color="red"
                              onClick={async () => {
                                try {
                                  await deleteAudioEntry(entry.id);
                                } catch (error) {
                                  console.error("Failed to delete entry:", error);
                                  alert(t("historySettings.deleteError"));
                                }
                              }}
                              className="text-text/50 hover:text-red-500 hover:bg-red-500/10 transition-colors"
                              title={t("historySettings.deleteTitle")}
                            >
                              <Trash2 className="w-4 h-4" />
                            </IconButton>
                          </Flex>
                        </Flex>
                        </Box>
                      </Flex>
                    );
                  })}
                </Box>
              );
            });
          })()}
          
          {/* Sentinel element for infinite scroll */}
          <div ref={observerTarget} className="h-4 w-full" />
        </Box>
      </ScrollArea>
    </Box>
  );
};

interface HistoryEntryProps {
  entry: HistoryEntry;
  getAudioUrl: (fileName: string) => Promise<string | null>;
}

const HistoryEntryComponent: React.FC<HistoryEntryProps> = ({
  entry,
  getAudioUrl,
}) => {
  const { t } = useTranslation();
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"improved" | "original">("improved");

  useEffect(() => {
    const loadAudio = async () => {
      const url = await getAudioUrl(entry.file_name);
      setAudioUrl(url);
    };
    loadAudio();
  }, [entry.file_name, getAudioUrl]);

  const hasImprovement = !!entry.post_processed_text;

  return (
    <Box className="group relative bg-background/40 backdrop-blur-md border border-white/10 rounded-xl shadow-sm hover:shadow-lg hover:border-white/20 transition-all duration-300 overflow-hidden">
      <Flex direction="column" className="p-4">
        {/* Content Tabs or Plain Text */}
        {hasImprovement ? (
          <Tabs.Root value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
            <Tabs.List size="1" className="mb-3">
              <Tabs.Trigger value="improved">
                {t("historySettings.content.improved")}
              </Tabs.Trigger>
              <Tabs.Trigger value="original">
                {t("historySettings.content.original")}
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

        {/* Audio Player */}
        {audioUrl && (
          <Box className="pt-3 border-t border-white/5">
            <AudioPlayer src={audioUrl} className="w-full" />
          </Box>
        )}
      </Flex>
    </Box>
  );
};
