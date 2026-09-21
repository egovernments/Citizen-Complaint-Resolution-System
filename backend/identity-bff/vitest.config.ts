import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 15000,
    hookTimeout: 30000,
    globalSetup: "./tests/setup.ts",
    setupFiles: ["./tests/worker-setup.ts"],
    include: [
      "tests/unit/keycloak-admin-session.test.ts",
      "tests/unit/token-verifier.test.ts",
      "tests/unit/managed-digit-users.test.ts",
      "tests/e2e/identity-bff.test.ts",
      "tests/e2e/onboarding-worker.test.ts",
    ],
    pool: "forks",
    fileParallelism: false,
    sequence: {
      // Run unit tests before E2E
      files: "list",
    },
  },
});
