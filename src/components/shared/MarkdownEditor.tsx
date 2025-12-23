import React, { forwardRef, useImperativeHandle, useRef } from "react";
import "./MarkdownEditor.css";

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}

export interface MarkdownEditorRef {
  insertText: (before: string, after: string) => void;
  focus: () => void;
  getSelection: () => { start: number; end: number };
}

export const MarkdownEditor = forwardRef<
  MarkdownEditorRef,
  MarkdownEditorProps
>(
  (
    { value, onChange, placeholder = "", className = "", style, onKeyDown },
    ref,
  ) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    useImperativeHandle(ref, () => ({
      insertText: (before: string, after: string) => {
        if (!textareaRef.current) return;
        const textarea = textareaRef.current;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const selectedText = value.substring(start, end);
        const newText =
          value.substring(0, start) +
          before +
          selectedText +
          after +
          value.substring(end);

        onChange(newText);

        // Restore selection after state update
        setTimeout(() => {
          textarea.focus();
          textarea.setSelectionRange(
            start + before.length,
            end + before.length,
          );
        }, 0);
      },
      focus: () => {
        textareaRef.current?.focus();
      },
      getSelection: () => ({
        start: textareaRef.current?.selectionStart || 0,
        end: textareaRef.current?.selectionEnd || 0,
      }),
    }));

    return (
      <div className={`markdown-editor-container ${className}`} style={style}>
        <textarea
          ref={textareaRef}
          className="markdown-editor-textarea"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          onKeyDown={onKeyDown}
          spellCheck={false}
        />
      </div>
    );
  },
);

MarkdownEditor.displayName = "MarkdownEditor";
