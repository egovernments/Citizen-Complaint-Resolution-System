import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const port = Number(process.env.KEYCLOAK_TEST_PORT || Number(process.env.REDIS_PORT || 16379) + 2000);
const env = { ...process.env, KEYCLOAK_TEST_PORT: String(port),
  KEYCLOAK_TEST_URL: `http://127.0.0.1:${port}`,
  KEYCLOAK_TEST_ADMIN_PASSWORD: randomBytes(32).toString("hex") };
const compose = ["compose", "-p", `identity-kc-test-${port}`, "-f",
  fileURLToPath(new URL("./compose.yaml", import.meta.url))];
const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { env, stdio: "inherit" });
  child.on("error", reject);
  child.on("exit", code => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
});
try {
  await run("docker", [...compose, "up", "-d"]);
  const deadline = Date.now() + 120_000;
  while (true) {
    const ready = await fetch(`${env.KEYCLOAK_TEST_URL}/realms/identity-test`, {
      signal: AbortSignal.timeout(2000),
    }).then(r => r.ok).catch(() => false);
    if (ready) break;
    if (Date.now() >= deadline) throw new Error("Keycloak test fixture did not become ready");
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  await run("npx", ["vitest", "run", ...(process.argv.slice(2).length
    ? process.argv.slice(2) : ["tests/e2e/keycloak-writer.real.test.ts", "tests/e2e/sync-reconcile.real.test.ts"])]);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await run("docker", [...compose, "down"]);
}
