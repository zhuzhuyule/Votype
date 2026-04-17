// Single model diff view with source + output panels

import { Editor, EditorContent } from "@tiptap/react";
import { IconTextPlus } from "@tabler/icons-react";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChangeStats } from "./diff-utils";
import { NeonBorder } from "./NeonBorder";

interface DiffViewPanelProps {
  sourceHtml: string;
  editor: Editor | null;
  isRerunning: boolean;
  currentModelName?: string;
  changeStats?: ChangeStats | null;
  onInsertOriginal?: () => void;
  onInsertPolished?: () => void;
  showInsertPolished?: boolean;
  insertShortcut?: string;
  isSubmitting?: boolean;
  /** The app-profile has signalled that English insertion is the default
   *  intent for the active window — the primary button becomes "插入英文". */
  translationIntended?: boolean;
  /** Translation is ready (either auto-triggered by intent, or manually by
   *  the user pressing Cmd+T). Controls whether the secondary button shows. */
  hasEnglishTranslation?: boolean;
  onInsertEnglish?: () => void;
  englishShortcut?: string;
  /** Which shortcut modifier the user is currently holding, so we can
   *  render a neon marquee border on the corresponding button + content. */
  pressedModifier?: "meta" | "ctrl" | null;
}

export const DiffViewPanel: React.FC<DiffViewPanelProps> = ({
  sourceHtml,
  editor,
  isRerunning,
  changeStats,
  onInsertOriginal,
  onInsertPolished,
  showInsertPolished = true,
  insertShortcut,
  isSubmitting = false,
  translationIntended = false,
  hasEnglishTranslation = false,
  onInsertEnglish,
  englishShortcut,
  pressedModifier,
}) => {
  const { t } = useTranslation();
  const [isSourceHovered, setIsSourceHovered] = useState(false);

  const focusEditor = () => {
    editor?.commands.focus();
  };

  const changePercent = changeStats?.changePercent ?? 0;
  // Layout contract:
  //   RIGHT button ("Insert", polished): ALWAYS present, fixed at bottom-right,
  //     bound to Ctrl+Enter.
  //   LEFT button ("Insert English" / "Insert Translation"): conditional,
  //     bound to Cmd+Enter.
  //
  //   - English intent (app-profile forces English):
  //       Right = Insert (secondary style, Ctrl+Enter)
  //       Left  = Insert English (primary style, Cmd+Enter) — always visible
  //   - Default mode, no translation:
  //       Right = Insert (primary style, Ctrl+Enter) — only button
  //   - Default mode, translation produced (via Cmd+T):
  //       Right = Insert (primary style, Ctrl+Enter)
  //       Left  = Insert Translation (secondary style, Cmd+Enter)
  const showEnglishLeft =
    !!onInsertEnglish && (translationIntended || hasEnglishTranslation);
  const englishLabel = translationIntended
    ? t("transcription.review.insertEnglish", "插入英文")
    : t("transcription.review.insertTranslation", "插入翻译");
  const rightIsPrimary = !translationIntended;
  const leftIsPrimary = translationIntended;
  const showActionRow =
    showInsertPolished && !!onInsertPolished && !isRerunning;

  return (
    <div className="review-content-area review-panels-layout">
      {/* Source text — simple inline frame with hover insert button */}
      <div
        className="review-source-inline"
        onMouseEnter={() => setIsSourceHovered(true)}
        onMouseLeave={() => setIsSourceHovered(false)}
      >
        <div dangerouslySetInnerHTML={{ __html: sourceHtml || "—" }} />
        {isSourceHovered && onInsertOriginal && (
          <button
            className="review-source-insert-btn"
            onClick={onInsertOriginal}
            title={t("transcription.review.insertOriginal")}
          >
            <IconTextPlus size={16} />
          </button>
        )}
      </div>
      {/* Final output panel — body (scrollable editor) and a persistent bottom
          action row. The row lives *below* the scrollable body so text never
          overlaps the buttons; it carries the change% badge + insert actions.
          When Ctrl is held (Insert's modifier), the whole card flashes a
          neon border to preview what will be inserted. */}
      <div
        className="review-panel review-panel-output review-polish-surface review-panel-output-compact"
        data-mod-armed={pressedModifier === "ctrl" ? "true" : undefined}
      >
        {pressedModifier === "ctrl" && (
          <NeonBorder
            radius={10}
            gradientId="review-neon-gradient-panel"
            strokeWidth={2.8}
            durationSec={3.2}
          />
        )}
        <div
          className="review-panel-body review-output-content"
          onMouseDown={(event) => {
            if (!(event.target instanceof HTMLElement)) {
              return;
            }

            if (event.target.closest("button")) {
              return;
            }

            if (event.target.closest(".ProseMirror")) {
              return;
            }
            event.preventDefault();
            focusEditor();
          }}
        >
          {isRerunning ? (
            <div className="candidate-loading-shimmer" />
          ) : (
            <EditorContent editor={editor} />
          )}
        </div>
        {showActionRow && (
          <div className="review-inline-action-row">
            {changePercent !== 0 && (
              <span
                className={`review-change-stats ${Math.abs(changePercent) < 20 ? "low" : Math.abs(changePercent) < 40 ? "mid" : "high"}`}
                title={`+${changeStats?.addedChars ?? 0} −${changeStats?.removedChars ?? 0}`}
              >
                {changePercent > 0 ? "+" : ""}
                {changePercent}%
              </span>
            )}
            <div className="review-inline-action-row-spacer" />
            {showEnglishLeft && (
              <button
                type="button"
                className={`${leftIsPrimary ? "review-btn-primary" : "review-btn-secondary"} review-inline-english-btn`}
                onClick={onInsertEnglish}
                disabled={isSubmitting}
                title={englishLabel}
                aria-label={englishLabel}
                data-mod-armed={pressedModifier === "meta" ? "true" : undefined}
              >
                {pressedModifier === "meta" && (
                  <NeonBorder
                    radius={8}
                    gradientId="review-neon-gradient-english"
                    // Primary (dark accent bg) needs a bolder stroke to cut
                    // through; secondary (pale bg) gets a thinner stroke so
                    // it doesn't look aggressive.
                    strokeWidth={leftIsPrimary ? 2.6 : 1.6}
                  />
                )}
                {englishLabel}
                {englishShortcut && (
                  <span
                    className="review-shortcut-hint"
                    data-mod-armed={
                      pressedModifier === "meta" ? "true" : undefined
                    }
                  >
                    {englishShortcut}
                  </span>
                )}
              </button>
            )}
            <button
              type="button"
              className={`${rightIsPrimary ? "review-btn-primary" : "review-btn-secondary"} review-inline-insert-btn`}
              onClick={onInsertPolished}
              disabled={isSubmitting || !onInsertPolished}
              title={t("transcription.review.insert", "Insert")}
              aria-label={t("transcription.review.insert", "Insert")}
              data-mod-armed={pressedModifier === "ctrl" ? "true" : undefined}
            >
              {pressedModifier === "ctrl" && (
                <NeonBorder
                  radius={8}
                  gradientId="review-neon-gradient-insert"
                  strokeWidth={rightIsPrimary ? 2.6 : 1.6}
                />
              )}
              {t("transcription.review.insert", "Insert")}
              {insertShortcut && (
                <span
                  className="review-shortcut-hint"
                  data-mod-armed={
                    pressedModifier === "ctrl" ? "true" : undefined
                  }
                >
                  {insertShortcut}
                </span>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
