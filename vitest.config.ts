import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Unit tests live next to the module they test; cross-layer tests live in test/integration.
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
  },
});
