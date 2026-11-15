import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Everything here is private and request-time; the classic dynamic model keeps it simple.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  poweredByHeader: false,
};

export default nextConfig;
