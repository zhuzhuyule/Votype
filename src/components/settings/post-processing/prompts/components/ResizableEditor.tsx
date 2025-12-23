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
  IconH1,
  IconItalic,
  IconLink,
  IconList,
  IconQuote,
  IconSparkles,
  IconX,
} from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
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
  tipKey: string;
}

export const ResizableEditor: React.FC<ResizableEditorProps> = ({
  label,
  value,
  onChange,
  placeholder,
  tipKey,
}) => {
  const { t } = useTranslation();
  const [height, setHeight] = useState(400);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [aiInstruction, setAiInstruction] = useState("");
  const [isAiLoading, setIsAiLoading] = useState(false);
  const isDragging = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(0);
  const editorRef = useRef<MarkdownEditorRef>(null);

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
      const newHeight = Math.max(150, startHeight.current + delta);
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
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true;
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
      toast.success(t("common.aiOptimizationSuccess") || "AI 优化成功");
    } catch (error) {
      console.error("AI optimization failed:", error);
      toast.error(
        typeof error === "string" ? error : "AI 优化失败，请检查配置",
      );
    } finally {
      setIsAiLoading(false);
    }
  };

  return (
    <Flex direction="column" gap="2">
      <Text size="2" weight="medium">
        {label}
      </Text>

      {/* Normal Mode Editor */}
      <Box className="relative group">
        <MarkdownEditor
          ref={isFullscreen ? null : editorRef}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          style={{ height }}
          onKeyDown={handleKeyDown}
        />

        {/* Toolcase: Fullscreen & AI Optimize */}
        <Box className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10 flex gap-1.5">
          <IconButton
            variant="soft"
            color="gray"
            size="1"
            onClick={handleAiOptimize}
            loading={isAiLoading}
            title={t("common.aiOptimize")}
            style={{ cursor: "pointer" }}
          >
            <IconSparkles size={14} />
          </IconButton>
          <IconButton
            variant="soft"
            color="gray"
            size="1"
            onClick={() => setIsFullscreen(true)}
            title={t("common.fullscreen")}
          >
            <IconArrowsMaximize size={14} />
          </IconButton>
        </Box>

        {/* Resize Handle */}
        <Box
          className="absolute bottom-0 left-1/2 w-full max-w-[200px] cursor-ns-resize flex items-center justify-center hover:bg-black/5 transition-colors rounded-b z-10"
          onMouseDown={handleMouseDown}
          style={{
            touchAction: "none",
            transform: "translate(-50%, 50%)",
            bottom: "1px",
            opacity: 0.6,
          }}
        >
          <Box className="w-full h-1.5 bg-gray-300 rounded-full group-hover:bg-gray-500 transition-colors shadow-sm" />
        </Box>
      </Box>

      <Text size="1" color="gray">
        <Trans
          i18nKey={tipKey}
          components={{
            code: (
              <code className="px-1.5 py-0.5 bg-gray-100/80 rounded text-xs font-mono text-gray-700 mx-1" />
            ),
            br: <br />,
          }}
        />
      </Text>

      {/* Full-screen Dialog Mode */}
      <Dialog.Root open={isFullscreen} onOpenChange={setIsFullscreen}>
        <Dialog.Content
          maxWidth="none"
          size="1"
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
            <Flex align="center" gap="4">
              <Dialog.Title
                m="0"
                style={{
                  fontSize: "var(--font-size-3)",
                  fontWeight: "var(--font-weight-bold)",
                }}
              >
                {label}
              </Dialog.Title>

              {/* Formatting Toolbar */}
              <Flex
                gap="1"
                ml="4"
                className="border-l pl-4 border-[var(--gray-5)]"
              >
                <Tooltip content={t("common.bold") || "加粗"}>
                  <IconButton
                    variant="ghost"
                    color="gray"
                    size="2"
                    onClick={() => handleFormat("bold")}
                  >
                    <IconBold size={18} />
                  </IconButton>
                </Tooltip>
                <Tooltip content={t("common.italic") || "斜体"}>
                  <IconButton
                    variant="ghost"
                    color="gray"
                    size="2"
                    onClick={() => handleFormat("italic")}
                  >
                    <IconItalic size={18} />
                  </IconButton>
                </Tooltip>
                <Tooltip content={t("common.h1") || "标题"}>
                  <IconButton
                    variant="ghost"
                    color="gray"
                    size="2"
                    onClick={() => handleFormat("h1")}
                  >
                    <IconH1 size={18} />
                  </IconButton>
                </Tooltip>
                <Tooltip content={t("common.list") || "无序列表"}>
                  <IconButton
                    variant="ghost"
                    color="gray"
                    size="2"
                    onClick={() => handleFormat("list")}
                  >
                    <IconList size={18} />
                  </IconButton>
                </Tooltip>
                <Tooltip content={t("common.quote") || "引用"}>
                  <IconButton
                    variant="ghost"
                    color="gray"
                    size="2"
                    onClick={() => handleFormat("quote")}
                  >
                    <IconQuote size={18} />
                  </IconButton>
                </Tooltip>
                <Tooltip content={t("common.code") || "行内代码"}>
                  <IconButton
                    variant="ghost"
                    color="gray"
                    size="2"
                    onClick={() => handleFormat("code")}
                  >
                    <IconCode size={18} />
                  </IconButton>
                </Tooltip>
                <Tooltip content={t("common.link") || "插入链接"}>
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
                {t("common.aiOptimize") || "AI 自动优润"}
              </Button>

              <IconButton
                variant="ghost"
                color="gray"
                size="2"
                onClick={() => setIsFullscreen(false)}
                title={t("common.exitFullscreen") || "还原"}
              >
                <IconArrowsMinimize size={18} />
              </IconButton>
              <Dialog.Close>
                <IconButton
                  variant="ghost"
                  color="gray"
                  size="2"
                  title={t("common.close") || "关闭"}
                >
                  <IconX size={18} />
                </IconButton>
              </Dialog.Close>
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
            <Box className="absolute bottom-8 right-8 z-20">
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
                {t("common.save") || "保存内容并退出全屏"}
              </Button>
            </Box>
          </Box>
        </Dialog.Content>
      </Dialog.Root>
    </Flex>
  );
};
