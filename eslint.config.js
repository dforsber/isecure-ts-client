import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      ".browser-check/**",
      ".chrome-wsapi-playwright/**",
      ".generated/**",
      "coverage/**",
      "dist/**",
      "dist-examples/**",
      "node_modules/**",
      "src/generated/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({ ...config, files: ["**/*.ts"] })),
  eslintConfigPrettier,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.eslint.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-empty-function": ["error", { allow: ["methods"] }],
    },
  },
  {
    files: ["**/*.test.ts"],
    rules: {
      "@typescript-eslint/require-await": "off",
    },
  },
);
