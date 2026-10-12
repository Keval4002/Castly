import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // sharp is native and heic-convert ships a WASM decoder; keep both out of the server bundle.
  serverExternalPackages: ["sharp", "heic-convert", "libheif-js"],
  poweredByHeader: false,
  // The local background-removal model (onnxruntime, ~300 MB) would exceed
  // Vercel's function size limit; on Vercel cleaning uses fal instead.
  ...(process.env.VERCEL && {
    outputFileTracingExcludes: {
      "/*": ["node_modules/onnxruntime-node/**", "node_modules/onnxruntime-web/**", "node_modules/@huggingface/transformers/**"],
    },
  }),
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
