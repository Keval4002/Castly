import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "server-only": path.resolve(import.meta.dirname, "tests/unit/server-only-stub.ts"),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    setupFiles: ["tests/unit/setup.ts"],
    // Integration tests share one database.
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
