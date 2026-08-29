import expoConfig from "eslint-config-expo/flat.js";

export const expoConfigWithIgnores = [
  ...expoConfig,
  { ignores: [".expo/**", "dist/**"] },
];
