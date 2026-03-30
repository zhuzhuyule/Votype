// ResizableEditor - A text editor with draggable resize handle and full-screen Dialog mode

import {
  Box,
  Button,
  Dialog,
  Flex,
  IconButton,
  Text,
  Tooltip,
} from "@radix-ui/themes";
import {
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconBold,
  IconCode,
  IconDeviceFloppy,
  IconGripHorizontal,
  IconH1,
  IconItalic,
  IconLink,
  IconList,
  IconQuote,
  IconSparkles,
} from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  MarkdownEditor,
  MarkdownEditorRef,
} from "../../../../shared/MarkdownEditor";

interface ResizableEditorProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  tipKey?: string;
  className?: string;
  style?: React.CSSProperties;
  minHeight?: number;
  defaultHeight?: number;
  hideTips?: boolean;
  showToolbar?: boolean;
  showLabel?: boolean;
  autoHeight?: boolean;
  maxAutoLines?: number;
  loading?: boolean;
  onAiLoadingChange?: (loading: boolean) => void;
  skillId?: string;
}

const KEY_FIELDS = [
  {
    name: "{{input-text}}",
    descKey: "settings.postProcessing.prompts.fieldInputTextDesc",
    descFallback: "Primary input text to process",
  },
  {
    name: "{{selected-text}}",
    descKey: "settings.postProcessing.prompts.fieldSelectedTextDesc",
    descFallback: "Selected text as weak context",
  },
];

const REFERENCE_FIELDS = [
  {
    name: "{{asr-reference}}",
    descKey: "settings.postProcessing.prompts.fieldAsrReferenceDesc",
    descFallback:
      "Auxiliary ASR reference used for correction and disambiguation",
  },
  {
    name: "{{person-names}}",
    descKey: "settings.postProcessing.prompts.fieldPersonNamesDesc",
    descFallback: "Known person names",
  },
  {
    name: "{{product-names}}",
    descKey: "settings.postProcessing.prompts.fieldProductNamesDesc",
    descFallback: "Known product or brand names",
  },
  {
    name: "{{domain-terms}}",
    descKey: "settings.postProcessing.prompts.fieldDomainTermsDesc",
    descFallback: "Domain terms and abbreviations",
  },
  {
    name: "{{hotwords}}",
    descKey: "settings.postProcessing.prompts.fieldHotwordsDesc",
    descFallback: "Other prioritized hotwords",
  },
  {
    name: "{{history-hints}}",
    descKey: "settings.postProcessing.prompts.fieldHistoryHintsDesc",
    descFallback: "Weak history hints",
  },
];

const INLINE_VARS = [
  {
    name: "{{app-name}}",
    descKey: "settings.postProcessing.prompts.varAppNameDesc",
    descFallback: "Current app name",
  },
  {
    name: "{{app-category}}",
    descKey: "settings.postProcessing.prompts.varAppCategoryDesc",
    descFallback: "App category (CodeEditor, Email, etc.)",
  },
  {
    name: "{{window-title}}",
    descKey: "settings.postProcessing.prompts.varWindowTitleDesc",
    descFallback: "Current window title",
  },
  {
    name: "{{time}}",
    descKey: "settings.postProcessing.prompts.varTimeDesc",
    descFallback: "Current time",
  },
  {
    name: "{{prompt}}",
    descKey: "settings.postProcessing.prompts.varPromptDesc",
    descFallback: "Skill display name",
  },
];

const FIELD_SUGGESTIONS = [...KEY_FIELDS, ...REFERENCE_FIELDS, ...INLINE_VARS];

interface PlaceholderMatch {
  start: number;
  end: number;
  query: string;
}

const CollapsibleTips: React.FC<{ tipKey: string; t: any }> = ({
  tipKey,
  t,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <Box className="mt-1">
      <Flex
        align="center"
        gap="2"
        className="cursor-pointer select-none opacity-60 hover:opacity-100 transition-opacity"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <Text size="1" color="gray" className="font-medium">
          {isExpanded ? "▼" : "▶"}{" "}
          {t("settings.postProcessing.prompts.inlineVarsLabel", "可引用字段")}:
        </Text>
        {!isExpanded && (
          <Text size="1" color="gray" className="font-mono opacity-70">
            {KEY_FIELDS.map((v) => v.name).join("  ")}
          </Text>
        )}
      </Flex>

      {isExpanded && (
        <Box className="mt-2 pl-3 border-l-2 border-gray-200 dark:border-gray-700 space-y-1.5">
          <Text
            size="1"
            color="gray"
            className="block"
            style={{ lineHeight: 1.4 }}
          >
            {t(
              "settings.postProcessing.prompts.autoInjectedNote",
              "The system injects the main input and supporting references automatically. You can also explicitly reference key fields when you need precise control.",
            )}
          </Text>
          <Box className="space-y-1 mt-1">
            <Text size="1" color="gray" className="block font-medium">
              {t(
                "settings.postProcessing.prompts.primaryFieldsLabel",
                "关键信息",
              )}
            </Text>
            {KEY_FIELDS.map((v) => (
              <Text key={v.name} size="1" color="gray" className="block">
                <code className="font-mono text-xs bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">
                  {v.name}
                </code>{" "}
                {t(v.descKey, v.descFallback)}
              </Text>
            ))}
            <Text
              size="1"
              color="gray"
              className="block"
              style={{ lineHeight: 1.4 }}
            >
              {t(
                "settings.postProcessing.prompts.explicitReferenceNote",
                "If you explicitly reference a field above, the system will not append the same field again at the end of the prompt.",
              )}
            </Text>
          </Box>
          <Box className="space-y-1 mt-1">
            <Text size="1" color="gray" className="block font-medium">
              {t(
                "settings.postProcessing.prompts.referenceFieldsLabel",
                "参考信息",
              )}
            </Text>
            {REFERENCE_FIELDS.map((v) => (
              <Text key={v.name} size="1" color="gray" className="block">
                <code className="font-mono text-xs bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">
                  {v.name}
                </code>{" "}
                {t(v.descKey, v.descFallback)}
              </Text>
            ))}
          </Box>
          <Box className="space-y-1 mt-1">
            <Text size="1" color="gray" className="block font-medium">
              {t(
                "settings.postProcessing.prompts.inlineVarsSecondaryLabel",
                "Secondary inline variables",
              )}
            </Text>
            {INLINE_VARS.map((v) => (
              <Text key={v.name} size="1" color="gray" className="block">
                <code className="font-mono text-xs bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">
                  {v.name}
                </code>{" "}
                {t(v.descKey, v.descFallback)}
              </Text>
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
};

export const ResizableEditor: React.FC<ResizableEditorProps> = ({
  label,
  value,
  onChange,
  placeholder,
  tipKey,
  className,
  style,
  minHeight = 150,
  defaultHeight = 500,
  hideTips = false,
  showToolbar = true,
  showLabel = true,
  autoHeight = false,
  maxAutoLines = 4,
  loading = false,
  onAiLoadingChange,
  skillId,
}) => {
  const { t } = useTranslation();
  const [height, setHeight] = useState(defaultHeight);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [aiInstruction, setAiInstruction] = useState("");
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [isSuggestionOpen, setIsSuggestionOpen] = useState(false);
  const [suggestionQuery, setSuggestionQuery] = useState("");
  const [suggestionRange, setSuggestionRange] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const isDragging = useRef(false);
  const isManualResized = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(0);
  const editorRef = useRef<MarkdownEditorRef>(null);

  const filteredSuggestions = FIELD_SUGGESTIONS.filter((field) =>
    field.name
      .replace(/[{}]/g, "")
      .toLowerCase()
      .includes(suggestionQuery.toLowerCase()),
  );

  const closeSuggestions = useCallback(() => {
    setIsSuggestionOpen(false);
    setSuggestionQuery("");
    setSuggestionRange(null);
    setActiveSuggestionIndex(0);
  }, []);

  const openSuggestions = useCallback((match: PlaceholderMatch) => {
    setIsSuggestionOpen(true);
    setSuggestionQuery(match.query);
    setSuggestionRange({ start: match.start, end: match.end });
    setActiveSuggestionIndex(0);
  }, []);

  const findPlaceholderMatch = useCallback(
    (text: string, start: number, end: number): PlaceholderMatch | null => {
      if (start !== end) return null;

      const completedPattern = /\{\{([a-z-]+)\}\}/g;
      for (const match of text.matchAll(completedPattern)) {
        const token = match[0];
        const tokenStart = match.index ?? 0;
        const tokenEnd = tokenStart + token.length;
        if (start >= tokenStart && start <= tokenEnd) {
          return {
            start: tokenStart,
            end: tokenEnd,
            query: match[1] ?? "",
          };
        }
      }

      const before = text.slice(0, start);
      const partial = before.match(/\{\{([a-z-]*)$/);
      if (!partial || partial.index == null) {
        return null;
      }

      return {
        start: partial.index,
        end: start,
        query: partial[1] ?? "",
      };
    },
    [],
  );

  const applySuggestion = useCallback(
    (fieldName: string) => {
      if (!editorRef.current || !suggestionRange) return;
      editorRef.current.replaceRange(
        suggestionRange.start,
        suggestionRange.end,
        fieldName,
      );
      closeSuggestions();
    },
    [closeSuggestions, suggestionRange],
  );

  const handleEditorSelectionChange = useCallback(
    (selection: { start: number; end: number }) => {
      const match = findPlaceholderMatch(value, selection.start, selection.end);
      if (match) {
        openSuggestions(match);
      } else if (isSuggestionOpen) {
        closeSuggestions();
      }
    },
    [
      closeSuggestions,
      findPlaceholderMatch,
      isSuggestionOpen,
      openSuggestions,
      value,
    ],
  );

  const handleEditorChange = useCallback(
    (nextValue: string, selection: { start: number; end: number }) => {
      const match = findPlaceholderMatch(
        nextValue,
        selection.start,
        selection.end,
      );
      if (match) {
        openSuggestions(match);
      } else if (isSuggestionOpen) {
        closeSuggestions();
      }
    },
    [closeSuggestions, findPlaceholderMatch, isSuggestionOpen, openSuggestions],
  );

  // Auto-height logic
  useEffect(() => {
    if (!autoHeight || isManualResized.current || isFullscreen) return;

    const textarea = document.querySelector(
      ".markdown-editor-textarea",
    ) as HTMLTextAreaElement;
    if (textarea) {
      const lineHeight = 1.6 * 13; // from MarkdownEditor.css
      const padding = 24; // 12px top + 12px bottom
      const minH = 1 * lineHeight + padding;
      const maxH = maxAutoLines * lineHeight + padding;

      // Use a cleaner way to measure scrollHeight without flickering
      const currentHeight = textarea.style.height;
      textarea.style.height = "auto";
      const scrollH = textarea.scrollHeight;
      textarea.style.height = currentHeight;

      const newHeight = Math.min(maxH, Math.max(minH, scrollH));
      if (Math.abs(newHeight - height) > 2) {
        setHeight(newHeight);
      }
    }
  }, [value, autoHeight, maxAutoLines, isFullscreen, height]);

  // Update height if defaultHeight changes
  useEffect(() => {
    setHeight(defaultHeight);
  }, [defaultHeight]);

  // Prevent body scroll when in fullscreen
  useEffect(() => {
    if (isFullscreen) {
      document.documentElement.style.overflow = "hidden";
      document.body.style.overflow = "hidden";
    } else {
      document.documentElement.style.overflow = "";
      document.body.style.overflow = "";
    }
    return () => {
      document.documentElement.style.overflow = "";
      document.body.style.overflow = "";
    };
  }, [isFullscreen]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = e.clientY - startY.current;
      const newHeight = Math.max(minHeight, startHeight.current + delta);
      setHeight(newHeight);
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [minHeight]);

  const handleMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true;
    isManualResized.current = true;
    startY.current = e.clientY;
    startHeight.current = height;
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
  };

  const handleFormat = (type: string) => {
    if (!editorRef.current) return;
    switch (type) {
      case "bold":
        editorRef.current.insertText("**", "**");
        break;
      case "italic":
        editorRef.current.insertText("*", "*");
        break;
      case "h1":
        editorRef.current.insertText("# ", "");
        break;
      case "list":
        editorRef.current.insertText("- ", "");
        break;
      case "quote":
        editorRef.current.insertText("> ", "");
        break;
      case "code":
        editorRef.current.insertText("`", "`");
        break;
      case "link":
        editorRef.current.insertText("[", "](url)");
        break;
      default:
        break;
    }
  };

  const handleAiOptimize = async () => {
    if (isAiLoading) return;
    setIsAiLoading(true);
    onAiLoadingChange?.(true);
    try {
      const optimizedText = await invoke<string>("optimize_text_with_llm", {
        text: value,
        instruction: aiInstruction || undefined,
        skillId: skillId || undefined,
      });
      onChange(optimizedText);
      setAiInstruction("");
      toast.success(t("common.aiOptimizationSuccess"));
    } catch (error) {
      console.error("AI optimization failed:", error);
      toast.error(
        typeof error === "string" ? error : t("common.aiOptimizationFailed"),
      );
    } finally {
      setIsAiLoading(false);
      onAiLoadingChange?.(false);
    }
  };

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (isFullscreen) {
          setIsFullscreen(false);
        }
        return;
      }

      if (!isSuggestionOpen) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveSuggestionIndex((prev) =>
          filteredSuggestions.length === 0
            ? 0
            : (prev + 1) % filteredSuggestions.length,
        );
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveSuggestionIndex((prev) =>
          filteredSuggestions.length === 0
            ? 0
            : (prev - 1 + filteredSuggestions.length) %
              filteredSuggestions.length,
        );
        return;
      }

      if (e.key === "Enter" || e.key === "Tab") {
        if (filteredSuggestions.length === 0) return;
        e.preventDefault();
        applySuggestion(filteredSuggestions[activeSuggestionIndex].name);
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        closeSuggestions();
      }
    },
    [
      activeSuggestionIndex,
      applySuggestion,
      closeSuggestions,
      filteredSuggestions,
      isSuggestionOpen,
      isFullscreen,
    ],
  );

  const renderSuggestionPanel = () => {
    if (!isSuggestionOpen) return null;

    const groupedSuggestions = [
      {
        title: t(
          "settings.postProcessing.prompts.primaryFieldsLabel",
          "关键信息",
        ),
        items: filteredSuggestions.filter((field) =>
          KEY_FIELDS.some((candidate) => candidate.name === field.name),
        ),
      },
      {
        title: t(
          "settings.postProcessing.prompts.referenceFieldsLabel",
          "参考信息",
        ),
        items: filteredSuggestions.filter((field) =>
          REFERENCE_FIELDS.some((candidate) => candidate.name === field.name),
        ),
      },
      {
        title: t(
          "settings.postProcessing.prompts.inlineVarsSecondaryLabel",
          "元数据变量",
        ),
        items: filteredSuggestions.filter((field) =>
          INLINE_VARS.some((candidate) => candidate.name === field.name),
        ),
      },
    ].filter((group) => group.items.length > 0);

    return (
      <Box className="absolute right-3 top-3 z-20 w-[320px] rounded-xl border border-[var(--gray-6)] bg-[var(--color-background)] p-2 shadow-[0_16px_40px_-18px_rgba(0,0,0,0.35)]">
        <Text size="1" color="gray" className="block px-2 pb-2 font-medium">
          {t(
            "settings.postProcessing.prompts.fieldAutocompleteTitle",
            "字段补全",
          )}
        </Text>
        <Box className="max-h-72 overflow-auto">
          {filteredSuggestions.length === 0 ? (
            <Text size="1" color="gray" className="block px-2 py-2">
              {t(
                "settings.postProcessing.prompts.fieldAutocompleteEmpty",
                "没有匹配的字段",
              )}
            </Text>
          ) : (
            groupedSuggestions.map((group) => (
              <Box key={group.title} className="mb-2 last:mb-0">
                <Text
                  size="1"
                  color="gray"
                  className="block px-2 pb-1 pt-1 font-medium"
                >
                  {group.title}
                </Text>
                {group.items.map((field) => {
                  const itemIndex = filteredSuggestions.findIndex(
                    (candidate) => candidate.name === field.name,
                  );
                  return (
                    <button
                      key={field.name}
                      type="button"
                      className={`w-full rounded-lg px-2 py-2 text-left transition-colors ${
                        itemIndex === activeSuggestionIndex
                          ? "bg-[var(--gray-4)]"
                          : "hover:bg-[var(--gray-3)]"
                      }`}
                      onMouseDown={(evt) => {
                        evt.preventDefault();
                        applySuggestion(field.name);
                      }}
                    >
                      <Text size="1" className="block font-mono">
                        {field.name}
                      </Text>
                      <Text size="1" color="gray" className="block mt-1">
                        {t(field.descKey, field.descFallback)}
                      </Text>
                    </button>
                  );
                })}
              </Box>
            ))
          )}
        </Box>
      </Box>
    );
  };

  return (
    <Flex direction="column" gap="2" className={className} style={style}>
      {showLabel && (
        <Flex justify="between" align="start">
          {/* Inline Collapsible Variables - replaces the title */}
          {!hideTips && tipKey ? (
            <CollapsibleTips tipKey={tipKey} t={t} />
          ) : (
            <Text size="1" color="gray" weight="medium" className="opacity-60">
              {label}
            </Text>
          )}
          {showToolbar && (
            <Flex gap="2" className="shrink-0 ml-3">
              <Tooltip content={t("common.aiOptimize")}>
                <IconButton
                  variant="soft"
                  color="gray"
                  size="1"
                  onClick={handleAiOptimize}
                  loading={isAiLoading}
                  style={{ cursor: "pointer" }}
                >
                  <IconSparkles size={14} />
                </IconButton>
              </Tooltip>
              <Tooltip content={t("common.fullscreen")}>
                <IconButton
                  variant="soft"
                  color="gray"
                  size="1"
                  onClick={() => setIsFullscreen(true)}
                  style={{ cursor: "pointer" }}
                >
                  <IconArrowsMaximize size={14} />
                </IconButton>
              </Tooltip>
            </Flex>
          )}
        </Flex>
      )}

      {/* Normal Mode Editor */}
      <Box
        className="relative"
        style={{ opacity: loading ? 0.6 : 1, transition: "opacity 0.2s" }}
      >
        <MarkdownEditor
          ref={isFullscreen ? null : editorRef}
          value={value}
          onChange={onChange}
          onChangeMeta={handleEditorChange}
          onSelectionChange={handleEditorSelectionChange}
          placeholder={placeholder}
          style={{ height }}
          onKeyDown={handleKeyDown}
        />
        {renderSuggestionPanel()}

        {/* Resize Handle - v4 refined icon */}
        <Box
          className="absolute bottom-0 left-1/2  flex items-center justify-center hover:bg-(--gray-3) transition-all rounded-full z-10 px-3 py-0.5 group cursor-row-resize"
          onMouseDown={handleMouseDown}
          style={{
            touchAction: "none",
            transform: "translate(-50%, 50%)",
            bottom: "0",
            opacity: 0.8,
            border: "1px solid var(--gray-5)",
            background: "var(--color-background)",
          }}
        >
          <IconGripHorizontal
            size={12}
            className="text-gray-400 group-hover:text-gray-600 transition-colors"
          />
        </Box>
      </Box>

      {/* Full-screen Dialog Mode */}
      <Dialog.Root open={isFullscreen} onOpenChange={setIsFullscreen}>
        <Dialog.Content
          maxWidth="none"
          size="1"
          onOpenAutoFocus={(e) => e.preventDefault()}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            width: "100%",
            height: "100%",
            maxHeight: "none",
            maxWidth: "none",
            padding: 0,
            margin: 0,
            borderRadius: 0,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            background: "var(--color-background)",
            zIndex: 9999,
          }}
          className="animate-fade-in"
        >
          {/* Header */}
          <Flex
            justify="between"
            align="center"
            px="6"
            py="4"
            style={{ flexShrink: 0 }}
            className="border-b border-[var(--gray-5)] bg-[var(--gray-1)]"
          >
            <Flex align="center" gap="5">
              <Text size="4" className="bold font-semibold">
                {label}
              </Text>

              {/* Formatting Toolbar */}
              <Flex gap="4" className="border-l pl-4">
                <Tooltip content={t("common.bold")}>
                  <IconButton
                    variant="ghost"
                    color="gray"
                    size="2"
                    onClick={() => handleFormat("bold")}
                  >
                    <IconBold size={18} />
                  </IconButton>
                </Tooltip>
                <Tooltip content={t("common.italic")}>
                  <IconButton
                    variant="ghost"
                    color="gray"
                    size="2"
                    onClick={() => handleFormat("italic")}
                  >
                    <IconItalic size={18} />
                  </IconButton>
                </Tooltip>
                <Tooltip content={t("common.h1")}>
                  <IconButton
                    variant="ghost"
                    color="gray"
                    size="2"
                    onClick={() => handleFormat("h1")}
                  >
                    <IconH1 size={18} />
                  </IconButton>
                </Tooltip>
                <Tooltip content={t("common.list")}>
                  <IconButton
                    variant="ghost"
                    color="gray"
                    size="2"
                    onClick={() => handleFormat("list")}
                  >
                    <IconList size={18} />
                  </IconButton>
                </Tooltip>
                <Tooltip content={t("common.quote")}>
                  <IconButton
                    variant="ghost"
                    color="gray"
                    size="2"
                    onClick={() => handleFormat("quote")}
                  >
                    <IconQuote size={18} />
                  </IconButton>
                </Tooltip>
                <Tooltip content={t("common.code")}>
                  <IconButton
                    variant="ghost"
                    color="gray"
                    size="2"
                    onClick={() => handleFormat("code")}
                  >
                    <IconCode size={18} />
                  </IconButton>
                </Tooltip>
                <Tooltip content={t("common.link")}>
                  <IconButton
                    variant="ghost"
                    color="gray"
                    size="2"
                    onClick={() => handleFormat("link")}
                  >
                    <IconLink size={18} />
                  </IconButton>
                </Tooltip>
              </Flex>
            </Flex>

            <Flex gap="3" align="center">
              {/* AI Optimization Button Only */}
              <Button
                variant="soft"
                loading={isAiLoading}
                onClick={handleAiOptimize}
                style={{ cursor: "pointer", marginRight: "16px" }}
              >
                <IconSparkles size={16} />
                {t("common.aiOptimize")}
              </Button>

              <Tooltip content={t("common.exitFullscreen")}>
                <IconButton
                  variant="ghost"
                  color="gray"
                  size="2"
                  onClick={() => setIsFullscreen(false)}
                >
                  <IconArrowsMinimize size={18} />
                </IconButton>
              </Tooltip>
            </Flex>
          </Flex>

          {/* Full-screen Editor Container */}
          <Box
            className="flex-1 overflow-hidden relative bg-[var(--color-panel-solid)]"
            onKeyDown={handleKeyDown}
          >
            <MarkdownEditor
              ref={isFullscreen ? editorRef : null}
              value={value}
              onChange={onChange}
              onChangeMeta={handleEditorChange}
              onSelectionChange={handleEditorSelectionChange}
              placeholder={placeholder}
              className="markdown-editor-fullscreen"
              style={{ height: "100%", border: "none" }}
              onKeyDown={handleKeyDown}
            />
            {renderSuggestionPanel()}

            {/* Quick Save Floating Button */}
            <Box className="absolute bottom-8 right-12 z-20">
              <Button
                variant="solid"
                size="3"
                onClick={() => setIsFullscreen(false)}
                className="shadow-[0_10px_40px_-10px_rgba(0,0,0,0.3)] hover:scale-105 transition-all duration-200 active:scale-95"
                style={{
                  borderRadius: "999px",
                  padding: "0 32px",
                  height: "56px",
                  fontSize: "16px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                <IconDeviceFloppy size={24} />
                {t("common.save")}
              </Button>
            </Box>
          </Box>
        </Dialog.Content>
      </Dialog.Root>
    </Flex>
  );
};
