import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          // Unit tests live next to the module they test; cross-layer tests live in test/integration.
          include: ["src/**/*.test.ts", "test/**/*.test.ts"],
        },
      },
      {
        esbuild: { jsx: "automatic" },
        test: {
          name: "web",
          environment: "jsdom",
          setupFiles: ["web/src/test-setup.ts"],
          testTimeout: 15_000,
          include: ["web/src/**/*.test.{ts,tsx}"],
        },
      },
    ],
  },
});
