// Mistakes the compiler doesn't see (promises nobody waits for, hooks called out of order, leftovers).
// Formatting is Prettier's job (`pnpm format`), not ESLint's.
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "apps/server/migrations/**", "apps/server/plugins/*/assets/**", "apps/web/public/**", "apps/desktop/src-tauri/target/**", "apps/desktop/src-tauri/gen/**", "apps/desktop/local-server/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-control-regex": "off",
      // The code's own idioms: "a && b()" and "(a(), b())" as statements, a default value assigned before a try, narrow spaces in formats.
      "@typescript-eslint/no-unused-expressions": "off",
      "no-useless-assignment": "off",
      "preserve-caught-error": "off",
      "no-irregular-whitespace": ["error", { skipStrings: true, skipTemplates: true, skipRegExps: true, skipComments: true }],
    },
  },
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: { "react-hooks/rules-of-hooks": "error", "react-hooks/exhaustive-deps": "warn" },
  },
);
