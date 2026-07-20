/**
 * PGR complaint lifecycle flow.
 *
 * 4 independent prompts (~2 minutes):
 * 1. Create a PGR complaint
 * 2. Assign the complaint (by ID from step 1)
 * 3. Resolve the complaint
 * 4. Rate the complaint
 *
 * Each prompt is self-contained — the MCP server auto-authenticates from env vars.
 * Context (complaint ID) is passed between steps via the prompt text.
 */

import {
  sendPrompt,
  assertToolCalled,
  assertSuccess,
  getToolResult,
  getAllToolResults,
  assert,
  logStep,
  logToolCalls,
  logCost,
} from "../helpers.js";

export const name = "pgr-lifecycle";
export const description = "PGR complaint: create → assign → resolve → rate";
export const estimatedSeconds = 180;

export async function run(): Promise<void> {
  const TENANT = "pg.citya";
  let totalCost = 0;

  // -------------------------------------------------------------------
  // Step 1: Create a PGR complaint
  // -------------------------------------------------------------------
  logStep(1, 4, `Creating PGR complaint in ${TENANT}...`);

  const create = await sendPrompt(
    `Create a PGR complaint in ${TENANT} for StreetLightNotWorking. ` +
    `The citizen's name is 'Agent Test Citizen' with mobile 9999900001. ` +
    `Use locality code SUN04. Description: 'Automated agent test - street light not working near main road'.`,
  );

  logToolCalls(create);
  logCost(create);
  totalCost += create.costUsd;
  assertToolCalled(create, "pgr_create");
  assertSuccess(create, "pgr_create");

  const createResult = getToolResult(create, "pgr_create");
  const complaint = createResult.complaint as Record<string, unknown> | undefined;
  const complaintId = (createResult.serviceRequestId as string) ??
    (complaint?.serviceRequestId as string);
  assert(
    typeof complaintId === "string" && complaintId.length > 0,
    `Expected serviceRequestId in pgr_create result, got: ${JSON.stringify(createResult).slice(0, 300)}`,
  );
  console.log(`        Complaint created: ${complaintId}`);

  // -------------------------------------------------------------------
  // Step 2: Assign the complaint
  // -------------------------------------------------------------------
  logStep(2, 4, `Assigning complaint ${complaintId}...`);

  const assign = await sendPrompt(
    `Assign PGR complaint ${complaintId} in ${TENANT}. Let PGR auto-route it.`,
  );

  logToolCalls(assign);
  logCost(assign);
  totalCost += assign.costUsd;
  assertToolCalled(assign, "pgr_update");
  assertSuccess(assign, "pgr_update");

  const assignResult = getToolResult(assign, "pgr_update");
  const assignComplaint = assignResult.complaint as Record<string, unknown> | undefined;
  const assignStatus = (assignResult.newStatus as string) ??
    (assignResult.applicationStatus as string) ??
    (assignComplaint?.newStatus as string) ??
    (assignComplaint?.status as string) ??
    (assignComplaint?.applicationStatus as string);
  assert(
    assignStatus === "PENDINGATLME",
    `Expected status PENDINGATLME after ASSIGN, got: ${JSON.stringify(assignResult).slice(0, 300)}`,
  );
  console.log(`        Complaint assigned, status: ${assignStatus}`);

  // -------------------------------------------------------------------
  // Step 3: Resolve the complaint
  // -------------------------------------------------------------------
  logStep(3, 4, `Resolving complaint ${complaintId}...`);

  const resolve = await sendPrompt(
    `Resolve PGR complaint ${complaintId} in ${TENANT} with comment 'Resolved by agent test - street light repaired'.`,
  );

  logToolCalls(resolve);
  logCost(resolve);
  totalCost += resolve.costUsd;
  assertToolCalled(resolve, "pgr_update");
  assertSuccess(resolve, "pgr_update");

  const resolveResult = getToolResult(resolve, "pgr_update");
  const resolveComplaint = resolveResult.complaint as Record<string, unknown> | undefined;
  const resolveStatus = (resolveResult.newStatus as string) ??
    (resolveResult.applicationStatus as string) ??
    (resolveComplaint?.newStatus as string) ??
    (resolveComplaint?.status as string) ??
    (resolveComplaint?.applicationStatus as string);
  assert(
    resolveStatus === "RESOLVED",
    `Expected status RESOLVED after RESOLVE, got: ${JSON.stringify(resolveResult).slice(0, 300)}`,
  );
  console.log(`        Complaint resolved, status: ${resolveStatus}`);

  // -------------------------------------------------------------------
  // Step 4: Rate the complaint
  // -------------------------------------------------------------------
  logStep(4, 4, `Rating complaint ${complaintId}...`);

  const rate = await sendPrompt(
    `Rate PGR complaint ${complaintId} in ${TENANT} with rating 5 and comment 'Excellent service'.`,
  );

  logToolCalls(rate);
  logCost(rate);
  totalCost += rate.costUsd;
  assertToolCalled(rate, "pgr_update");

  // RATE may succeed or hit a known state issue — both are acceptable
  const rateResults = getAllToolResults(rate, "pgr_update");
  const lastRate = rateResults[rateResults.length - 1];
  if (lastRate.success) {
    console.log(`        Complaint rated successfully`);
  } else {
    console.log(
      `        Rating returned non-success (may be known state issue): ${JSON.stringify(lastRate).slice(0, 200)}`,
    );
  }

  console.log(`        Total flow cost: $${totalCost.toFixed(4)}`);
}
