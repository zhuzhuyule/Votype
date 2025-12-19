import tsParser from "@typescript-eslint/parser";
import i18next from "eslint-plugin-i18next";

export default [
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      i18next,
    },
    rules: {
      // Forbid importing Card directly from @radix-ui/themes
      // Use our custom Card component from '@/components/ui/Card' instead
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@radix-ui/themes"],
              importNamePattern: "^Card$",
              message:
                "Use custom Card from '@/components/ui/Card' instead of Radix Card",
            },
          ],
        },
      ],
      // Catch text in JSX that should be translated
      "i18next/no-literal-string": [
        "error",
        {
          markupOnly: true, // Only check JSX content, not all strings
          ignoreAttribute: [
            "className",
            "style",
            "type",
            "id",
            "name",
            "key",
            "data-*",
            "aria-*",
          ], // Ignore common non-translatable attributes
        },
      ],
    },
  },
];
