import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettierConfig from "eslint-config-prettier";

export default [
  {
    ignores: ["node_modules/", ".atl/", "*.tgz", "package-lock.json"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
];
