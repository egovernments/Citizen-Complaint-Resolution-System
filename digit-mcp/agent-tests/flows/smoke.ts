/**
 * Smoke test flow — quick health check of the DIGIT MCP server.
 *
 * 3 independent prompts, ~30-60 seconds:
 * 1. List all tenants
 * 2. Validate a specific tenant exists
 * 3. Health check all services
 *
 * Assertions verify behavior (correct results), not specific tool names,
 * since the agent may choose equivalent approaches.
 */

import {
  sendPrompt,
  assertToolCalled,
  assertSuccess,
  getToolResult,
  assert,
  logStep,
  logToolCalls,
  logCost,
  type TurnResult,
} from "../helpers.js";

export const name = "smoke";
export const description = "Quick health check: list tenants, validate tenant, health check";
export const estimatedSeconds = 60;

/** Check if any MCP tool (not built-in) was called. */
function assertMcpToolUsed(result: TurnResult): void {
  const mcpCalls = result.toolCalls.filter((tc) => tc.name.startsWith("mcp__"));
  assert(
    mcpCalls.length > 0,
    `Expected at least one MCP tool call. Called: [${result.toolCalls.map((tc) => tc.name).join(", ")}]`,
  );
}

export async function run(): Promise<void> {
  let totalCost = 0;

  // -------------------------------------------------------------------
  // Step 1: List tenants
  // -------------------------------------------------------------------
  logStep(1, 3, "Listing all tenants...");

  const tenants = await sendPrompt(
    "List all tenants in the DIGIT system.",
  );

  logToolCalls(tenants);
  logCost(tenants);
  totalCost += tenants.costUsd;
  assertToolCalled(tenants, "mdms_get_tenants");
  assertSuccess(tenants, "mdms_get_tenants");

  const tenantsResult = getToolResult(tenants, "mdms_get_tenants");
  assert(
    typeof tenantsResult.count === "number" && (tenantsResult.count as number) > 0,
    `Expected at least 1 tenant, got count: ${tenantsResult.count}`,
  );
  console.log(`        Found ${tenantsResult.count} tenants`);

  // -------------------------------------------------------------------
  // Step 2: Validate a specific tenant exists
  // -------------------------------------------------------------------
  logStep(2, 3, "Validating tenant pg.citya...");

  const validate = await sendPrompt(
    "Check whether tenant pg.citya exists in the DIGIT system.",
  );

  logToolCalls(validate);
  logCost(validate);
  totalCost += validate.costUsd;

  // Agent may use validate_tenant or mdms_get_tenants — both are valid
  assertMcpToolUsed(validate);
  assert(
    validate.text.toLowerCase().includes("pg.citya") ||
      validate.text.toLowerCase().includes("city a") ||
      validate.text.toLowerCase().includes("exists") ||
      validate.text.toLowerCase().includes("found") ||
      validate.text.toLowerCase().includes("valid"),
    `Expected response to confirm pg.citya exists. Got: ${validate.text.slice(0, 300)}`,
  );

  // -------------------------------------------------------------------
  // Step 3: Health check
  // -------------------------------------------------------------------
  logStep(3, 3, "Running health check on all services...");

  const health = await sendPrompt(
    "Check the health of all DIGIT platform services.",
  );

  logToolCalls(health);
  logCost(health);
  totalCost += health.costUsd;
  assertToolCalled(health, "health_check");

  const healthResult = getToolResult(health, "health_check");
  assert(
    healthResult.services !== undefined || healthResult.results !== undefined,
    `Expected health check to return services or results`,
  );

  console.log(`        Total flow cost: $${totalCost.toFixed(4)}`);
}
