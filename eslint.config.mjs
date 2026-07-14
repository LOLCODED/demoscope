import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "coverage/**",
      "extension/dist/**",
      "extension/scripts/tour-footage/site/film.js",
      "extension/scripts/tour-footage/site/sample/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    // Extension code runs in the browser / service worker with the chrome API.
    files: ["extension/**/*.ts"],
    languageOptions: {
      globals: { ...globals.browser, chrome: "readonly" },
    },
  },
  {
    // Tour-footage harness: node scripts whose page.evaluate callbacks run in
    // the browser (extension pages included, hence the chrome API).
    files: ["extension/scripts/tour-footage/**/*.mjs"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser, chrome: "readonly" },
    },
  },
  prettier
);
