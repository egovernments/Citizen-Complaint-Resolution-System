#!/usr/bin/env tsx
/**
 * Agent-based MCP flow test runner.
 *
 * Usage:
 *   tsx run.ts                   # Run all flows
 *   tsx run.ts --flow smoke      # Run only the smoke flow
 *   tsx run.ts --flow pgr-lifecycle --flow smoke  # Run multiple flows
 *
 * Environment vars (all have defaults):
 *   CRS_USERNAME        — DIGIT admin username (default: ADMIN)
 *   CRS_PASSWORD        — DIGIT admin password (default: eGov@123)
 *   CRS_ENVIRONMENT     — DIGIT environment key (default: chakshu-digit)
 *   CRS_API_URL         — DIGIT API URL override
 *   AGENT_TEST_MODEL    — Claude model to use (default: claude-sonnet-4-5-20250929)
 */

import { execSync } from "node:child_process";
import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Flow {
  name: string;
  description: string;
  estimatedSeconds: number;
  run: () => Promise<void>;
}

interface FlowResult {
  name: string;
  status: "pass" | "fail";
  durationMs: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// ANSI colors
// ---------------------------------------------------------------------------

const C = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
};

// ---------------------------------------------------------------------------
// Preflight checks
// ---------------------------------------------------------------------------

function preflight(): boolean {
  let ok = true;

  // Check MCP server is built
  const serverPath = path.resolve(import.meta.dirname ?? ".", "../dist/index.js");
  try {
    execSync(`node -e "require.resolve('${serverPath}')"`, { stdio: "ignore" });
  } catch {
    console.log(
      `${C.yellow}WARN${C.reset}: MCP server not built. Building now...`,
    );
    try {
      execSync("npm run build", {
        cwd: path.resolve(import.meta.dirname ?? ".", ".."),
        stdio: "inherit",
      });
      console.log(`${C.green}OK${C.reset}: MCP server built successfully`);
    } catch {
      console.error(
        `${C.red}ERROR${C.reset}: Failed to build MCP server. Run 'npm run build' in /root/DIGIT-MCP`,
      );
      ok = false;
    }
  }

  return ok;
}

// ---------------------------------------------------------------------------
// Flow discovery
// ---------------------------------------------------------------------------

async function loadFlows(): Promise<Flow[]> {
  const flowModules = [
    await import("./flows/smoke.js"),
    await import("./flows/pgr-lifecycle.js"),
    await import("./flows/employee-mgmt.js"),
    await import("./flows/guided-setup.js"),
  ];

  return flowModules.map((m) => ({
    name: m.name,
    description: m.description,
    estimatedSeconds: m.estimatedSeconds,
    run: m.run,
  }));
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(): { flowNames: string[]; verbose: boolean } {
  const args = process.argv.slice(2);
  const flowNames: string[] = [];
  let verbose = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--flow" && i + 1 < args.length) {
      flowNames.push(args[++i]);
    }
    if (args[i] === "--verbose" || args[i] === "-v") {
      verbose = true;
    }
  }

  return { flowNames, verbose };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\n${C.bold}DIGIT MCP Agent Flow Tests${C.reset}`);
  console.log(`${C.dim}${"─".repeat(50)}${C.reset}\n`);

  // Preflight
  if (!preflight()) {
    process.exit(1);
  }

  // Load flows
  const allFlows = await loadFlows();
  const { flowNames, verbose } = parseArgs();

  // Enable verbose logging in helpers
  if (verbose) {
    const { setVerbose } = await import("./helpers.js");
    setVerbose(true);
  }

  // Filter flows if --flow specified
  let flows: Flow[];
  if (flowNames.length > 0) {
    flows = [];
    for (const name of flowNames) {
      const found = allFlows.find((f) => f.name === name);
      if (!found) {
        console.error(
          `${C.red}ERROR${C.reset}: Unknown flow "${name}". Available: ${allFlows.map((f) => f.name).join(", ")}`,
        );
        process.exit(1);
      }
      flows.push(found);
    }
  } else {
    flows = allFlows;
  }

  // Print plan
  console.log(`${C.bold}Flows to run:${C.reset}`);
  for (const f of flows) {
    console.log(`  ${C.cyan}${f.name}${C.reset} — ${f.description} (~${f.estimatedSeconds}s)`);
  }
  console.log(
    `\nModel: ${C.cyan}${process.env.AGENT_TEST_MODEL ?? "claude-sonnet-4-5-20250929"}${C.reset}`,
  );
  console.log(`${C.dim}${"─".repeat(50)}${C.reset}\n`);

  // Run flows
  const results: FlowResult[] = [];

  for (const flow of flows) {
    console.log(`${C.bold}▶ ${flow.name}${C.reset}: ${flow.description}`);
    const t0 = Date.now();

    try {
      await flow.run();
      const ms = Date.now() - t0;
      results.push({ name: flow.name, status: "pass", durationMs: ms });
      console.log(
        `  ${C.green}✓ PASS${C.reset} ${C.dim}(${(ms / 1000).toFixed(1)}s)${C.reset}\n`,
      );
    } catch (err) {
      const ms = Date.now() - t0;
      const errMsg = err instanceof Error ? err.message : String(err);
      results.push({
        name: flow.name,
        status: "fail",
        durationMs: ms,
        error: errMsg,
      });
      console.log(
        `  ${C.red}✗ FAIL${C.reset} ${C.dim}(${(ms / 1000).toFixed(1)}s)${C.reset}`,
      );
      console.log(`  ${C.red}${errMsg}${C.reset}\n`);
    }
  }

  // Summary
  console.log(`${C.dim}${"─".repeat(50)}${C.reset}`);
  console.log(`${C.bold}Summary${C.reset}\n`);

  const passed = results.filter((r) => r.status === "pass");
  const failed = results.filter((r) => r.status === "fail");
  const totalMs = results.reduce((s, r) => s + r.durationMs, 0);

  for (const r of results) {
    const icon = r.status === "pass" ? `${C.green}✓` : `${C.red}✗`;
    const time = `${(r.durationMs / 1000).toFixed(1)}s`;
    console.log(`  ${icon} ${r.name}${C.reset} ${C.dim}(${time})${C.reset}`);
    if (r.error) {
      console.log(`    ${C.red}${r.error}${C.reset}`);
    }
  }

  console.log(
    `\n  ${C.green}${passed.length} passed${C.reset}, ${failed.length > 0 ? `${C.red}${failed.length} failed${C.reset}` : `${C.dim}0 failed${C.reset}`} ${C.dim}(${(totalMs / 1000).toFixed(1)}s total)${C.reset}\n`,
  );

  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`${C.red}Fatal error:${C.reset}`, err);
  process.exit(1);
});
