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
      "docs-api/**",
      "node_modules/**",
      "src/generated/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked.map((config) => ({ ...config, files: ["**/*.ts"] })),
  ...tseslint.configs.stylisticTypeChecked.map((config) => ({ ...config, files: ["**/*.ts"] })),
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
      // Template numbers are fine to interpolate.
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      // The codebase deliberately uses object type aliases (unions, envelopes).
      "@typescript-eslint/consistent-type-definitions": "off",
      // `call<Res, Req>` intentionally exposes the request-body type at the
      // call site even though `Req` appears once in the signature.
      "@typescript-eslint/no-unnecessary-type-parameters": "off",
      // The SDK targets both Node and browsers, so runtime-environment and
      // defensive guards are intentional even where the lib types say the value
      // is always present.
      "@typescript-eslint/no-unnecessary-condition": "off",
    },
  },
  {
    files: ["**/*.test.ts"],
    rules: {
      "@typescript-eslint/require-await": "off",
    },
  },
);
