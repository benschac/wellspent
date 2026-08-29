import "./app/env";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@repo/api-client", "@repo/api-contract"],
};

export default nextConfig;
