import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          // Unit tests live next to the module they test; cross-layer tests live in test/integration.
          include: ["src/**/*.test.ts", "test/**/*.test.ts"],
          // Several suites start real processes and git; under the parallel load of a full run 5 s is not enough.
          testTimeout: 20_000,
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
