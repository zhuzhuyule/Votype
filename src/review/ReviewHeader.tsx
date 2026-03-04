// Header with prompt/model selector and close button

import { invoke } from "@tauri-apps/api/core";
import { Editor } from "@tiptap/react";
import React from "react";
import { useTranslation } from "react-i18next";
import { CancelIcon } from "../components/icons";
import { buildDiffViews } from "./diff-utils";

export interface PromptInfo {
  id: string;
  name: string;
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
  onPromptChange: (promptId: string) => void;
  onModelChange: (modelId: string) => void;
  onCancel: () => void;
  onSourceHtmlChange: (html: string) => void;
  onModelNameChange: (name: string) => void;
  onRerunStart: () => void;
  onRerunEnd: () => void;
  onMeasureAndResize: (reposition: boolean) => void;
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
  onPromptChange,
  onModelChange,
  onCancel,
  onSourceHtmlChange,
  onModelNameChange,
  onRerunStart,
  onRerunEnd,
  onMeasureAndResize,
}) => {
  const { t } = useTranslation();

  const handlePromptChangeMulti = async (newId: string) => {
    onPromptChange(newId);
    onRerunStart();
    try {
      await invoke("rerun_multi_model_with_prompt", {
        promptId: newId,
        sourceText,
        historyId,
      });
    } catch (err) {
      console.error("Failed to rerun:", err);
    }
  };

  const handlePromptChangeSingle = async (newId: string) => {
    onPromptChange(newId);
    onRerunStart();
    try {
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
      if (resp.text && editor) {
        const views = buildDiffViews(sourceText, resp.text);
        editor.commands.setContent(views.targetHtml, {
          emitUpdate: false,
        });
        onSourceHtmlChange(views.sourceHtml);
        setTimeout(() => onMeasureAndResize(false), 16);
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
      if (resp.text && editor) {
        const views = buildDiffViews(sourceText, resp.text);
        editor.commands.setContent(views.targetHtml, {
          emitUpdate: false,
        });
        onSourceHtmlChange(views.sourceHtml);
        setTimeout(() => onMeasureAndResize(false), 16);
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
      </div>
      <div className="review-close-button review-close-btn" onClick={onCancel}>
        <CancelIcon />
      </div>
    </div>
  );
};
