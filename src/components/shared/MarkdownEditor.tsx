import React, { forwardRef, useImperativeHandle, useRef } from "react";
import "./MarkdownEditor.css";

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  onChangeMeta?: (
    value: string,
    selection: { start: number; end: number },
  ) => void;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSelectionChange?: (selection: { start: number; end: number }) => void;
}

export interface MarkdownEditorRef {
  insertText: (before: string, after: string) => void;
  replaceRange: (start: number, end: number, text: string) => void;
  focus: () => void;
  getSelection: () => { start: number; end: number };
}

export const MarkdownEditor = forwardRef<
  MarkdownEditorRef,
  MarkdownEditorProps
>(
  (
    {
      value,
      onChange,
      onChangeMeta,
      placeholder = "",
      className = "",
      style,
      onKeyDown,
      onSelectionChange,
    },
    ref,
  ) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    // Store last cursor position when editor loses focus
    const lastSelectionStart = useRef<number>(0);
    const lastSelectionEnd = useRef<number>(0);

    const saveSelection = () => {
      if (textareaRef.current) {
        lastSelectionStart.current = textareaRef.current.selectionStart;
        lastSelectionEnd.current = textareaRef.current.selectionEnd;
        onSelectionChange?.({
          start: lastSelectionStart.current,
          end: lastSelectionEnd.current,
        });
      }
    };

    useImperativeHandle(ref, () => ({
      insertText: (before: string, after: string) => {
        if (!textareaRef.current) return;
        const textarea = textareaRef.current;

        // Use saved position if textarea doesn't have focus (selection would be 0,0)
        const isFocused = document.activeElement === textarea;
        const start = isFocused
          ? textarea.selectionStart
          : lastSelectionStart.current;
        const end = isFocused
          ? textarea.selectionEnd
          : lastSelectionEnd.current;

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
      replaceRange: (start: number, end: number, text: string) => {
        if (!textareaRef.current) return;
        const textarea = textareaRef.current;
        const newText = value.substring(0, start) + text + value.substring(end);
        onChange(newText);
        onChangeMeta?.(newText, {
          start: start + text.length,
          end: start + text.length,
        });

        setTimeout(() => {
          textarea.focus();
          textarea.setSelectionRange(start + text.length, start + text.length);
        }, 0);
      },
      focus: () => {
        textareaRef.current?.focus();
      },
      getSelection: () => ({
        start:
          textareaRef.current?.selectionStart || lastSelectionStart.current,
        end: textareaRef.current?.selectionEnd || lastSelectionEnd.current,
      }),
    }));

    return (
      <div className={`markdown-editor-container ${className}`} style={style}>
        <textarea
          ref={textareaRef}
          className="markdown-editor-textarea"
          value={value}
          onChange={(e) => {
            const nextValue = e.target.value;
            const selection = {
              start: e.target.selectionStart,
              end: e.target.selectionEnd,
            };
            onChange(nextValue);
            onChangeMeta?.(nextValue, selection);
          }}
          placeholder={placeholder}
          onKeyDown={onKeyDown}
          onBlur={saveSelection}
          onSelect={saveSelection}
          spellCheck={false}
        />
      </div>
    );
  },
);

MarkdownEditor.displayName = "MarkdownEditor";
