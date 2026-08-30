import { baseConfig } from "@repo/eslint-config/base";

export default [
  {
    ignores: ["src-tauri/target/**"],
  },
  ...baseConfig,
  {
    languageOptions: {
      globals: {
        document: "readonly",
      },
    },
  },
];
