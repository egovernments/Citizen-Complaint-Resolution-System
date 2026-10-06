import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 15000,
    hookTimeout: 30000,
    globalSetup: "./tests/setup.ts",
    setupFiles: ["./tests/worker-setup.ts"],
    // Globs, so a new test file can't be silently left out of the run.
    include: [
      "tests/unit/**/*.test.ts",
      "tests/contract/**/*.test.ts",
      "tests/e2e/**/*.test.ts",
    ],
    pool: "forks",
    fileParallelism: false,
    sequence: {
      // Run unit tests before E2E
      files: "list",
    },
  },
});
