import "./app/env";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.WELLSPENT_NEXT_DIST_DIR || ".next",
  reactCompiler: true,
  transpilePackages: [
    "@repo/api-client",
    "@repo/api-contract",
    "@repo/lib",
    "@repo/session-domain",
    "@repo/timer",
  ],
  webpack(config) {
    config.resolve.extensions = [
      ".web.mjs",
      ".web.tsx",
      ".web.ts",
      ".web.jsx",
      ".web.js",
      ...config.resolve.extensions,
    ];
    config.resolve.alias = {
      ...config.resolve.alias,
      "react-native-reanimated": false,
      "react-native-reanimated/package.json": false,
      "react-native/Libraries/Image/AssetRegistry": false,
    };
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      path: false,
    };

    return config;
  },
};

export default nextConfig;
