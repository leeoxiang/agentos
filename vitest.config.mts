import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    // Mirror the "@/*" alias from tsconfig so tests import the same way the app does.
    alias: { "@": path.resolve(__dirname, ".") },
  },
  test: {
    environment: "node",
    // Several tests read live pool state and verify signatures against chain,
    // which is the point — they'd pass against a mock while the real thing was
    // broken. The tradeoff is that they need a working RPC and more time.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    include: ["test/**/*.test.ts"],
  },
});
