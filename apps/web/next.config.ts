import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // packages/shared ships compiled JS, but transpiling it keeps a workspace edit visible
  // in dev without a rebuild step.
  transpilePackages: ["@data-room/shared"],
};

export default config;
