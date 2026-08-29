import { baseConfig } from "@repo/eslint-config/base";

export default [
  ...baseConfig,
  {
    languageOptions: {
      globals: {
        document: "readonly",
      },
    },
  },
];
