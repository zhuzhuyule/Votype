import { Mark } from "@tiptap/core";

export const DiffMark = Mark.create({
  name: "diffMark",
  addAttributes() {
    return {
      level: {
        default: "minor",
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: "span[data-diff-level]",
        getAttrs: (element) => {
          if (!(element instanceof HTMLElement)) return false;
          return { level: element.getAttribute("data-diff-level") };
        },
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const level = HTMLAttributes.level ?? "minor";
    return [
      "span",
      {
        ...HTMLAttributes,
        "data-diff-level": level,
        class: `diff-mark diff-${level}`,
      },
      0,
    ];
  },
});
