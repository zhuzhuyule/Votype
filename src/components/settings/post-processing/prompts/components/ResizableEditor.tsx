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
}

const CollapsibleTips: React.FC<{ tipKey: string; t: any }> = ({
  tipKey,
  t,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  // Common variables shown when collapsed
  const commonVars = ["${output}", "${select}", "${context}"];

  return (
    <Box className="mt-1">
      <Flex
        align="center"
        gap="2"
        className="cursor-pointer select-none opacity-60 hover:opacity-100 transition-opacity"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <Text size="1" color="gray" className="font-medium">
          {isExpanded ? "▼" : "▶"} {t("common.variables")}:
        </Text>
        {!isExpanded && (
          <Text size="1" color="gray" className="font-mono opacity-70">
            {commonVars.join(" ")}
          </Text>
        )}
      </Flex>

      {isExpanded && (
        <Box className="mt-2 pl-3 border-l-2 border-gray-200 dark:border-gray-700 space-y-1">
          <Text size="1" color="gray" className="block">
            <code className="font-mono text-xs bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">
              {"${output}"}
            </code>{" "}
            {t("settings.postProcessing.prompts.varOutputDesc")}
          </Text>
          <Text size="1" color="gray" className="block">
            <code className="font-mono text-xs bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">
              {"${raw_input}"}
            </code>{" "}
            {t("settings.postProcessing.prompts.varRawInputDesc")}
          </Text>
          <Text size="1" color="gray" className="block">
            <code className="font-mono text-xs bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">
              {"${select}"}
            </code>{" "}
            {t("settings.postProcessing.prompts.varSelectDesc")}
          </Text>
          <Text size="1" color="gray" className="block">
            <code className="font-mono text-xs bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">
              {"${streaming_output}"}
            </code>{" "}
            {t("settings.postProcessing.prompts.varStreamingDesc")}
          </Text>
          <Text size="1" color="gray" className="block">
            <code className="font-mono text-xs bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">
              {"${hot_words}"}
            </code>{" "}
            {t("settings.postProcessing.prompts.varHotWordsDesc")}
          </Text>
          <Text size="1" color="gray" className="block">
            <code className="font-mono text-xs bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">
              {"${prompt}"}
            </code>{" "}
            {t("settings.postProcessing.prompts.varPromptDesc")}
          </Text>
          <Text size="1" color="gray" className="block">
            <code className="font-mono text-xs bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded">
              {"${context}"}
            </code>{" "}
            {t("settings.postProcessing.prompts.varContextDesc")}
          </Text>
          <Text size="1" color="gray" className="block mt-2 italic opacity-80">
            {t("settings.postProcessing.prompts.jsonHint")}
          </Text>
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
}) => {
  const { t } = useTranslation();
  const [height, setHeight] = useState(defaultHeight);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [aiInstruction, setAiInstruction] = useState("");
  const [isAiLoading, setIsAiLoading] = useState(false);
  const isDragging = useRef(false);
  const isManualResized = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(0);
  const editorRef = useRef<MarkdownEditorRef>(null);

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

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (isFullscreen) {
          setIsFullscreen(false);
        }
      }
    },
    [isFullscreen],
  );

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
    try {
      const optimizedText = await invoke<string>("optimize_text_with_llm", {
        text: value,
        instruction: aiInstruction || undefined,
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
    }
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
          placeholder={placeholder}
          style={{ height }}
          onKeyDown={handleKeyDown}
        />

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
              placeholder={placeholder}
              className="markdown-editor-fullscreen"
              style={{ height: "100%", border: "none" }}
              onKeyDown={handleKeyDown}
            />

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
