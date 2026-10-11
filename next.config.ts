import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // sharp is a native module; keep it out of the server bundle.
  serverExternalPackages: ["sharp"],
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  images: {
    remotePatterns: [{ protocol: "https", hostname: "*.supabase.co" }],
  },
};

export default nextConfig;
