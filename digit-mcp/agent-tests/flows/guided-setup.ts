/**
 * Guided city setup flow on a NEW ROOT TENANT (not pg).
 *
 * Tests the full "set up a new state from scratch" demo flow:
 * 1. Bootstrap a new root tenant (copies schemas + data from pg)
 * 2. Set up a city under the new root: tenant, boundaries, workflow, employees
 * 3. File a citizen complaint in the new city
 * 4. Assign the complaint
 * 5. Resolve the complaint
 * 6. Cleanup both root and city
 *
 * Each prompt is self-contained (fresh MCP server per call). Since the MCP
 * server defaults to pg, prompts that operate on the new root must tell
 * Claude to configure the state tenant first.
 *
 * NOTE: DIGIT Java services (PGR, HRMS, idgen) are deployed with
 * STATE_LEVEL_TENANT_ID=pg. The tenant_bootstrap tool copies MDMS data
 * to the new root, but Java services may still reference pg's data.
 * This test verifies whether the full lifecycle works end-to-end on
 * a non-pg root.
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
  type TurnResult,
} from "../helpers.js";

export const name = "guided-setup";
export const description = "Bootstrap new root → setup city → file complaint → assign → resolve → cleanup";
export const estimatedSeconds = 360;

/** Check if any MCP tool (not built-in) was called. */
function assertMcpToolUsed(result: TurnResult): void {
  const mcpCalls = result.toolCalls.filter((tc) => tc.name.startsWith("mcp__"));
  assert(
    mcpCalls.length > 0,
    `Expected at least one MCP tool call. Called: [${result.toolCalls.map((tc) => tc.name).join(", ")}]`,
  );
}

/** Extract tool short name from qualified name. */
function shortName(qualifiedName: string): string {
  const parts = qualifiedName.split("__");
  return parts[parts.length - 1];
}

/** Convert a number to a base-26 letter string (0→a, 25→z, 26→ba, etc). */
function toLetters(n: number): string {
  let s = "";
  let num = n;
  while (num > 0) {
    s = String.fromCharCode(97 + (num % 26)) + s;
    num = Math.floor(num / 26);
  }
  return s || "a";
}

export async function run(): Promise<void> {
  // Unique IDs for this run — DIGIT tenant codes must be letters-only
  const RUN_NUM = Date.now() % 100000;
  const LETTERS = toLetters(RUN_NUM);
  const ROOT = `gs${LETTERS}`;
  const CITY = `${ROOT}.city`;
  const LOCALITY = `LOC${LETTERS.toUpperCase()}`;
  const GRO_PHONE = `98${String(RUN_NUM).padStart(8, "0")}`;
  const LME_PHONE = `91${String(RUN_NUM).padStart(8, "0")}`;
  const CITIZEN_PHONE = `70${String(RUN_NUM).padStart(8, "0")}`;

  let totalCost = 0;
  let complaintId: string | null = null;

  console.log(`        Root: ${ROOT}, City: ${CITY}, Locality: ${LOCALITY}`);

  try {
    // -------------------------------------------------------------------
    // Step 1: Bootstrap a new root tenant
    // -------------------------------------------------------------------
    logStep(1, 6, `Bootstrapping new root tenant ${ROOT} from pg...`);

    const bootstrap = await sendPrompt(
      `Bootstrap a new root tenant called "${ROOT}" by copying all schemas ` +
      `and data from pg. This will be a new state-level tenant for setting up cities.`,
      { maxTurns: 10 },
    );

    logToolCalls(bootstrap);
    logCost(bootstrap);
    totalCost += bootstrap.costUsd;
    assertToolCalled(bootstrap, "tenant_bootstrap");

    const bootstrapResult = getToolResult(bootstrap, "tenant_bootstrap");
    // Bootstrap may partially succeed (some schemas have empty x-unique constraints)
    const summary = bootstrapResult.summary as Record<string, number> | undefined;
    const schemasCopied = summary?.schemas_copied ?? 0;
    assert(
      bootstrapResult.success === true || schemasCopied > 10,
      `Bootstrap failed: ${JSON.stringify(bootstrapResult).slice(0, 400)}`,
    );
    console.log(
      `        Schemas: ${schemasCopied} copied, ${summary?.schemas_skipped ?? 0} skipped, ` +
      `${summary?.schemas_failed ?? 0} failed`,
    );
    console.log(
      `        Data: ${summary?.data_copied ?? 0} copied, ${summary?.data_skipped ?? 0} skipped`,
    );

    // -------------------------------------------------------------------
    // Step 2: Set up city — tenant, boundaries, workflow, employees
    // -------------------------------------------------------------------
    logStep(2, 6, `Setting up city ${CITY} under ${ROOT}...`);

    const setup = await sendPrompt(
      `I want to set up a new city for citizen grievance management under a new state.\n\n` +
      `IMPORTANT: First, configure the state tenant to "${ROOT}" (not pg).\n\n` +
      `Then set up everything:\n` +
      `- Create city tenant ${CITY} under ${ROOT}, city name "Test City" ` +
      `(MDMS schema: tenant.tenants, unique identifier: Tenant.${CITY}, parent: "${ROOT}")\n` +
      `- Set up boundary hierarchy (Country > State > District > City > Ward > Locality) ` +
      `with codes: COUNTRY${LETTERS.toUpperCase()}, STATE${LETTERS.toUpperCase()}, ` +
      `DISTRICT${LETTERS.toUpperCase()}, CITY${LETTERS.toUpperCase()}, ` +
      `WARD${LETTERS.toUpperCase()}, and ${LOCALITY}\n` +
      `- Copy PGR workflow to ${ROOT} from pg\n` +
      `- Create GRO: Rajesh Kumar, phone ${GRO_PHONE}, roles EMPLOYEE + GRO + DGRO, ` +
      `department DEPT_1, designation DESIG_1, jurisdiction City boundary ${CITY}\n` +
      `- Create field worker: Priya S, phone ${LME_PHONE}, roles EMPLOYEE + PGR_LME, ` +
      `department DEPT_1, designation DESIG_1, jurisdiction City boundary ${CITY}\n\n` +
      `Make sure this city is fully ready for PGR complaints.`,
      { maxTurns: 25 },
    );

    logToolCalls(setup);
    logCost(setup);
    totalCost += setup.costUsd;
    assertMcpToolUsed(setup);

    const toolNames = setup.toolCalls.map((tc) => shortName(tc.name));
    console.log(`        Setup called ${setup.toolCalls.length} tools across ${setup.numTurns} turns`);

    // Verify key setup tools were called
    const hasBoundaryCreate = toolNames.some((n) => n === "boundary_create");
    assert(hasBoundaryCreate, `Expected boundary_create. Tools: [${toolNames.join(", ")}]`);

    // Check employee creation results
    const empResults = setup.toolResults
      .filter((r) => shortName(r.toolName) === "employee_create")
      .map((r) => r.parsed);
    const empSuccess = empResults.filter((r) => r?.success === true);
    const empFailed = empResults.filter((r) => r?.success === false);

    if (empSuccess.length > 0) {
      console.log(`        Employees: ${empSuccess.length} created, ${empFailed.length} failed`);
    }
    if (empFailed.length > 0) {
      const firstError = JSON.stringify(empFailed[0]).slice(0, 200);
      if (firstError.includes("getUser()") || firstError.includes("null")) {
        console.log(`        Known HRMS bug: ${firstError}`);
      } else {
        console.log(`        Employee errors: ${firstError}`);
      }
    }

    // -------------------------------------------------------------------
    // Step 3: File a citizen complaint
    // -------------------------------------------------------------------
    logStep(3, 6, `Filing complaint in ${CITY}...`);

    const fileComplaint = await sendPrompt(
      `Configure state tenant to "${ROOT}", then file a PGR complaint in ${CITY}.\n\n` +
      `Citizen: Ravi Kumar, phone ${CITIZEN_PHONE}.\n` +
      `Problem: streetlight not working near Anna Nagar.\n` +
      `Locality code: ${LOCALITY}. Service code: StreetLightNotWorking.`,
    );

    logToolCalls(fileComplaint);
    logCost(fileComplaint);
    totalCost += fileComplaint.costUsd;
    assertToolCalled(fileComplaint, "pgr_create");
    assertSuccess(fileComplaint, "pgr_create");

    const createResult = getToolResult(fileComplaint, "pgr_create");
    const complaint = createResult.complaint as Record<string, unknown> | undefined;
    complaintId = (createResult.serviceRequestId as string) ??
      (complaint?.serviceRequestId as string);
    assert(
      typeof complaintId === "string" && complaintId.length > 0,
      `Expected complaint ID, got: ${JSON.stringify(createResult).slice(0, 300)}`,
    );
    console.log(`        Complaint filed: ${complaintId}`);

    // -------------------------------------------------------------------
    // Step 4: Assign the complaint
    // -------------------------------------------------------------------
    logStep(4, 6, `Assigning complaint ${complaintId}...`);

    const assign = await sendPrompt(
      `Configure state tenant to "${ROOT}", then assign PGR complaint ${complaintId} ` +
      `in ${CITY}. Let the system auto-route it.`,
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
      `Expected PENDINGATLME after assign, got: ${JSON.stringify(assignResult).slice(0, 300)}`,
    );
    console.log(`        Assigned, status: ${assignStatus}`);

    // -------------------------------------------------------------------
    // Step 5: Resolve the complaint
    // -------------------------------------------------------------------
    logStep(5, 6, `Resolving complaint ${complaintId}...`);

    const resolve = await sendPrompt(
      `Configure state tenant to "${ROOT}", then resolve PGR complaint ${complaintId} ` +
      `in ${CITY}. The streetlight has been repaired.`,
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
      `Expected RESOLVED after resolve, got: ${JSON.stringify(resolveResult).slice(0, 300)}`,
    );
    console.log(`        Resolved, status: ${resolveStatus}`);

    console.log(`        Total flow cost: $${totalCost.toFixed(4)}`);
  } finally {
    // -------------------------------------------------------------------
    // Step 6: Cleanup (best effort — don't fail the test)
    // -------------------------------------------------------------------
    logStep(6, 6, `Cleaning up ${ROOT} and ${CITY}...`);

    try {
      const cleanup = await sendPrompt(
        `Clean up after a test run. Deactivate all MDMS data and users for ` +
        `tenant "${ROOT}". Then also clean up "${CITY}" if possible.`,
        { maxTurns: 10 },
      );
      logToolCalls(cleanup);
      logCost(cleanup);
      totalCost += cleanup.costUsd;
      console.log(`        Cleanup completed`);
    } catch (err) {
      console.log(`        Cleanup failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
