// Header with prompt/model selector and close button

import {
  IconArrowsSort,
  IconBolt,
  IconDelta,
  IconEye,
  IconEyeOff,
  IconLanguage,
  IconLoader2,
} from "@tabler/icons-react";
import { invoke } from "@tauri-apps/api/core";
import { Editor } from "@tiptap/react";
import React from "react";
import { useTranslation } from "react-i18next";
import { CancelIcon } from "../components/icons";

export interface PromptInfo {
  id: string;
  name: string;
  /** Special flag to indicate skipping post-processing */
  isSkipPostProcess?: boolean;
}

export interface ReviewModelOption {
  id: string;
  label: string;
  model_id: string;
  provider_id: string;
}

interface ReviewHeaderProps {
  mode: "multi" | "polish" | "chat";
  skillName?: string | null;
  prompts: PromptInfo[];
  selectedPromptId: string;
  modelOptions: ReviewModelOption[];
  selectedModelId: string;
  defaultModelLabel: string;
  sourceText: string;
  historyId: number | null;
  editor: Editor | null;
  showDiff?: boolean;
  onShowDiffChange?: (show: boolean) => void;
  onPromptChange: (promptId: string) => void;
  onModelChange: (modelId: string) => void;
  onCancel: () => void;
  onInsertOriginal: () => void;
  onTranslate: () => void;
  isTranslating?: boolean;
  onSourceHtmlChange: (html: string) => void;
  onModelNameChange: (name: string) => void;
  onRerunStart: () => void;
  onRerunEnd: () => void;
  onMeasureAndResize: (reposition: boolean) => void;
  onRerunResult?: (text: string) => void;
  multiSortMode?: "default" | "speed" | "change";
  onMultiSortModeChange?: (mode: "default" | "speed" | "change") => void;
  /** Label of the currently selected candidate in multi mode */
  selectedCandidateLabel?: string | null;
}

export const ReviewHeader: React.FC<ReviewHeaderProps> = ({
  mode,
  skillName,
  prompts,
  selectedPromptId,
  modelOptions,
  selectedModelId,
  defaultModelLabel,
  sourceText,
  historyId,
  editor,
  showDiff,
  onShowDiffChange,
  onPromptChange,
  onModelChange,
  onCancel,
  onInsertOriginal,
  onTranslate,
  isTranslating,
  onSourceHtmlChange,
  onModelNameChange,
  onRerunStart,
  onRerunEnd,
  onMeasureAndResize,
  onRerunResult,
  multiSortMode,
  onMultiSortModeChange,
  selectedCandidateLabel,
}) => {
  const { t } = useTranslation();

  const handlePromptChangeMulti = async (newId: string) => {
    onPromptChange(newId);
    onRerunStart();
    try {
      // Prompt selection in review window is session-local only;
      // global default is only changed from the settings page.
      await invoke("rerun_multi_model_with_prompt", {
        promptId: newId,
        sourceText,
        historyId,
      });
    } catch (err) {
      console.error("Failed to rerun:", err);
      onRerunEnd();
    }
  };

  const handlePromptChangeSingle = async (newId: string) => {
    onPromptChange(newId);
    onRerunStart();
    try {
      // Prompt selection in review window is session-local only;
      // global default is only changed from the settings page.
      const resp = await invoke<{
        text: string | null;
        error: string | null;
        model: string | null;
      }>("rerun_single_with_prompt", {
        promptId: newId,
        sourceText,
        historyId,
        modelId: selectedModelId || null,
      });
      if (resp.model) onModelNameChange(resp.model);
      if (resp.text) {
        onRerunResult?.(resp.text);
      }
    } catch (err) {
      console.error("Failed to rerun:", err);
    } finally {
      onRerunEnd();
    }
  };

  const handleModelChange = async (newModelId: string) => {
    onModelChange(newModelId);
    onRerunStart();
    try {
      const resp = await invoke<{
        text: string | null;
        error: string | null;
        model: string | null;
      }>("rerun_single_with_prompt", {
        promptId: selectedPromptId,
        sourceText,
        historyId,
        modelId: newModelId || null,
      });
      if (resp.model) onModelNameChange(resp.model);
      if (resp.text) {
        onRerunResult?.(resp.text);
      }
    } catch (err) {
      console.error("Failed to rerun:", err);
    } finally {
      onRerunEnd();
    }
  };

  if (mode === "multi") {
    return (
      <div className="review-header">
        <div className="review-header-left">
          <span className="review-panel-label">
            {t("transcription.review.source", "ASR 结果")}
          </span>
          {prompts.length > 1 ? (
            <select
              className="prompt-select"
              value={selectedPromptId}
              onChange={(e) => handlePromptChangeMulti(e.target.value)}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {prompts.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : prompts.length === 1 ? (
            <span className="review-prompt-badge">{prompts[0].name}</span>
          ) : null}
          {selectedCandidateLabel && (
            <span className="review-model-badge">{selectedCandidateLabel}</span>
          )}
          <button
            type="button"
            className={`review-multi-sort-btn ${multiSortMode !== "default" ? "active" : ""}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => {
              const next =
                multiSortMode === "default"
                  ? "speed"
                  : multiSortMode === "speed"
                    ? "change"
                    : "default";
              onMultiSortModeChange?.(next);
            }}
            title={
              multiSortMode === "speed"
                ? t("transcription.review.sortByChange", "按变化幅度排序")
                : multiSortMode === "change"
                  ? t("transcription.review.restoreOrder", "恢复原顺序")
                  : t("transcription.review.sortBySpeed", "按反应速率排序")
            }
          >
            {multiSortMode === "speed" ? (
              <IconBolt size={14} />
            ) : multiSortMode === "change" ? (
              <IconDelta size={14} />
            ) : (
              <IconArrowsSort size={14} />
            )}
            <span>
              {multiSortMode === "speed"
                ? t("transcription.review.speedSorted", "速度优先")
                : multiSortMode === "change"
                  ? t("transcription.review.changeSorted", "变化优先")
                  : t("transcription.review.sortLabel", "排序")}
            </span>
          </button>
          <div
            className="review-tooltip review-tooltip-bottom"
            data-tooltip={t("transcription.review.translateText", "翻译查看")}
          >
            <button
              className={`review-translate-btn ${isTranslating ? "loading" : ""}`}
              onClick={onTranslate}
              onPointerDown={(e) => e.stopPropagation()}
              disabled={isTranslating}
            >
              {isTranslating ? (
                <IconLoader2 size={14} className="spinning" />
              ) : (
                <IconLanguage size={14} />
              )}
            </button>
          </div>
        </div>
        <div
          className="review-close-button review-close-btn"
          onClick={onCancel}
        >
          <CancelIcon />
        </div>
      </div>
    );
  }

  if (mode === "chat") {
    return (
      <div className="review-header">
        <div className="review-skill-name">
          {skillName ||
            t("transcription.review.generationTitle", "AI Assistant")}
        </div>
        <div
          className="review-close-button review-close-btn"
          onClick={onCancel}
        >
          <CancelIcon />
        </div>
      </div>
    );
  }

  // mode === "polish"
  return (
    <div className="review-header">
      <div className="review-header-left">
        <span className="review-panel-label">
          {t("transcription.review.source", "Live transcript")}
        </span>
        {prompts.length > 1 ? (
          <select
            className="prompt-select"
            value={selectedPromptId}
            onChange={(e) => handlePromptChangeSingle(e.target.value)}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {prompts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        ) : prompts.length === 1 ? (
          <span className="review-prompt-badge">{prompts[0].name}</span>
        ) : null}
        {modelOptions.length > 1 && (
          <select
            className="prompt-select model-select"
            value={selectedModelId}
            onChange={(e) => handleModelChange(e.target.value)}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <option value="">
              {defaultModelLabel
                ? `${t("common.default", "Default")} (${defaultModelLabel})`
                : t("common.default", "Default")}
            </option>
            {modelOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label !== m.model_id ? m.label : m.model_id}
              </option>
            ))}
          </select>
        )}
        <div
          className="review-tooltip review-tooltip-bottom"
          data-tooltip={
            showDiff
              ? t("transcription.review.hideDiff", "隐藏差异标注")
              : t("transcription.review.showDiff", "显示差异标注")
          }
        >
          <button
            className={`review-diff-toggle${showDiff ? " active" : ""}`}
            onClick={() => onShowDiffChange?.(!showDiff)}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {showDiff ? <IconEye size={14} /> : <IconEyeOff size={14} />}
          </button>
        </div>
        <div
          className="review-tooltip review-tooltip-bottom"
          data-tooltip={t("transcription.review.translateText", "翻译查看")}
        >
          <button
            className={`review-translate-btn ${isTranslating ? "loading" : ""}`}
            onClick={onTranslate}
            onPointerDown={(e) => e.stopPropagation()}
            disabled={isTranslating}
          >
            {isTranslating ? (
              <IconLoader2 size={14} className="spinning" />
            ) : (
              <IconLanguage size={14} />
            )}
          </button>
        </div>
      </div>
      <div className="review-close-button review-close-btn" onClick={onCancel}>
        <CancelIcon />
      </div>
    </div>
  );
};
