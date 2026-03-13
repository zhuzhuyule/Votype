// Pure markdown to HTML conversion functions
// No React dependencies

import { escapeHtml } from "../lib/utils/html";
import { hljs } from "./highlight";

// Helper function to process inline markdown elements
const processInlineMarkdown = (text: string): string => {
  let result = escapeHtml(text);

  // Bold: **text** or __text__
  result = result.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  result = result.replace(/__([^_]+)__/g, "<strong>$1</strong>");

  // Italic: *text* or _text_
  result = result.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  result = result.replace(/_([^_]+)_/g, "<em>$1</em>");

  // Strikethrough: ~~text~~
  result = result.replace(/~~([^~]+)~~/g, "<del>$1</del>");

  // Links: [text](url)
  result = result.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>',
  );

  // Images: ![alt](url)
  result = result.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    '<img src="$2" alt="$1" loading="lazy" />',
  );

  return result;
};

export const simpleMarkdownToHtml = (text: string): string => {
  const start = performance.now();
  // Use unique placeholders that won't conflict with markdown syntax
  const PLACEHOLDER_PREFIX = "\x00CB"; // Code Block
  const PLACEHOLDER_SUFFIX = "\x00";
  const INLINE_PREFIX = "\x00IC"; // Inline Code

  // Protect code blocks first
  const codeBlocks: string[] = [];
  let html = text.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const trimmedCode = code.trim();
    let highlightedCode = "";
    try {
      if (lang && hljs.getLanguage(lang)) {
        highlightedCode = hljs.highlight(trimmedCode, { language: lang }).value;
      } else {
        highlightedCode = hljs.highlightAuto(trimmedCode).value;
      }
    } catch {
      highlightedCode = escapeHtml(trimmedCode);
    }
    codeBlocks.push(
      `<pre><code class="hljs language-${lang}">${highlightedCode}</code></pre>`,
    );
    return `${PLACEHOLDER_PREFIX}${codeBlocks.length - 1}${PLACEHOLDER_SUFFIX}`;
  });

  // Protect inline code
  const inlineCodes: string[] = [];
  html = html.replace(/`([^`\n]+)`/g, (_, code) => {
    inlineCodes.push(`<code>${escapeHtml(code)}</code>`);
    return `${INLINE_PREFIX}${inlineCodes.length - 1}${PLACEHOLDER_SUFFIX}`;
  });

  // Split into lines for processing
  const lines = html.split("\n");
  const processedLines: string[] = [];
  let inList = false;
  let listType = "";
  let inBlockquote = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip placeholder lines (code blocks) - pass them through unchanged
    if (line.includes(PLACEHOLDER_PREFIX) || line.includes(INLINE_PREFIX)) {
      if (inList) {
        processedLines.push(listType === "ul" ? "</ul>" : "</ol>");
        inList = false;
      }
      if (inBlockquote) {
        processedLines.push("</blockquote>");
        inBlockquote = false;
      }
      processedLines.push(line);
      continue;
    }

    // Check for headings (# ## ### etc.)
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      if (inList) {
        processedLines.push(listType === "ul" ? "</ul>" : "</ol>");
        inList = false;
      }
      if (inBlockquote) {
        processedLines.push("</blockquote>");
        inBlockquote = false;
      }
      const level = headingMatch[1].length;
      const content = processInlineMarkdown(headingMatch[2]);
      processedLines.push(`<h${level}>${content}</h${level}>`);
      continue;
    }

    // Check for blockquote
    const blockquoteMatch = line.match(/^>\s?(.*)$/);
    if (blockquoteMatch) {
      if (inList) {
        processedLines.push(listType === "ul" ? "</ul>" : "</ol>");
        inList = false;
      }
      if (!inBlockquote) {
        processedLines.push("<blockquote>");
        inBlockquote = true;
      }
      const content = processInlineMarkdown(blockquoteMatch[1]);
      processedLines.push(`<p>${content}</p>`);
      continue;
    } else if (inBlockquote) {
      processedLines.push("</blockquote>");
      inBlockquote = false;
    }

    // Check for unordered list
    const ulMatch = line.match(/^[\s]*[-*+]\s+(.+)$/);
    if (ulMatch) {
      if (inList && listType !== "ul") {
        processedLines.push(listType === "ul" ? "</ul>" : "</ol>");
        inList = false;
      }
      if (!inList) {
        processedLines.push('<ul class="contains-task-list">');
        inList = true;
        listType = "ul";
      }
      const content = processInlineMarkdown(ulMatch[1]);
      processedLines.push(`<li>${content}</li>`);
      continue;
    }

    // Check for task list item
    const taskMatch = line.match(/^[\s]*[-*+]\s+\[([ xX])\]\s+(.+)$/);
    if (taskMatch) {
      if (inList && listType !== "ul") {
        processedLines.push(listType === "ul" ? "</ul>" : "</ol>");
        inList = false;
      }
      if (!inList) {
        processedLines.push('<ul class="contains-task-list">');
        inList = true;
        listType = "ul";
      }
      const isChecked = taskMatch[1].toLowerCase() === "x";
      const taskContent = processInlineMarkdown(taskMatch[2]);
      processedLines.push(
        `<li><input type="checkbox" disabled${isChecked ? " checked" : ""} /><span>${taskContent}</span></li>`,
      );
      continue;
    }

    // Check for ordered list
    const olMatch = line.match(/^[\s]*\d+\.\s+(.+)$/);
    if (olMatch) {
      if (inList && listType !== "ol") {
        processedLines.push("</ul>");
        inList = false;
      }
      if (!inList) {
        processedLines.push("<ol>");
        inList = true;
        listType = "ol";
      }
      const content = processInlineMarkdown(olMatch[1]);
      processedLines.push(`<li>${content}</li>`);
      continue;
    }

    // Close list if we're no longer in one
    if (inList && line.trim() !== "") {
      processedLines.push(listType === "ul" ? "</ul>" : "</ol>");
      inList = false;
    }

    // Check for table
    const tableMatch = line.match(/^\|[\s\S]+\|$/);
    if (tableMatch) {
      if (inBlockquote) {
        processedLines.push("</blockquote>");
        inBlockquote = false;
      }

      // Check if this is a header separator row
      const isHeaderSeparator = /^[\s\|:\-]+$/.test(line);
      if (isHeaderSeparator) {
        continue;
      }

      // Parse table cells
      const cells = line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());
      const isFirstRow =
        processedLines.length === 0 ||
        !processedLines[processedLines.length - 1].startsWith("<table");

      if (isFirstRow) {
        processedLines.push("<table><thead><tr>");
        cells.forEach((cell) => {
          processedLines.push(`<th>${processInlineMarkdown(cell)}</th>`);
        });
        processedLines.push("</tr></thead><tbody>");
      } else {
        processedLines.push("<tr>");
        cells.forEach((cell) => {
          processedLines.push(`<td>${processInlineMarkdown(cell)}</td>`);
        });
        processedLines.push("</tr>");
      }
      continue;
    }

    // Check for horizontal rule
    if (/^[-*_]{3,}$/.test(line.trim())) {
      processedLines.push("<hr>");
      continue;
    }

    // Regular paragraph
    if (line.trim() === "") {
      processedLines.push("");
    } else {
      const content = processInlineMarkdown(line);
      processedLines.push(`<p>${content}</p>`);
    }
  }

  // Close any open lists, blockquotes, or tables
  if (inList) {
    processedLines.push(listType === "ul" ? "</ul>" : "</ol>");
  }
  if (inBlockquote) {
    processedLines.push("</blockquote>");
  }

  // Close table if open
  if (processedLines.length > 0) {
    const lastLine = processedLines[processedLines.length - 1];
    if (
      lastLine &&
      (lastLine.startsWith("<tr>") || lastLine.startsWith("<thead>"))
    ) {
      processedLines.push("</tbody></table>");
    }
  }

  html = processedLines.join("\n");

  // Restore inline code
  const inlineCodeRegex = new RegExp(
    `${INLINE_PREFIX}(\\d+)${PLACEHOLDER_SUFFIX}`,
    "g",
  );
  html = html.replace(inlineCodeRegex, (_, index) => {
    return inlineCodes[parseInt(index)];
  });

  // Restore code blocks
  const codeBlockRegex = new RegExp(
    `${PLACEHOLDER_PREFIX}(\\d+)${PLACEHOLDER_SUFFIX}`,
    "g",
  );
  html = html.replace(codeBlockRegex, (_, index) => {
    return codeBlocks[parseInt(index)];
  });

  // Clean up empty paragraphs
  html = html.replace(/<p><\/p>/g, "");

  const durationMs = Math.round(performance.now() - start);
  console.debug("[markdown-utils] simpleMarkdownToHtml", {
    textChars: text.length,
    codeBlocks: codeBlocks.length,
    inlineCodes: inlineCodes.length,
    htmlChars: html.length,
    durationMs,
  });

  return html;
};
