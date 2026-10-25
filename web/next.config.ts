import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@factory/droid-sdk"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
