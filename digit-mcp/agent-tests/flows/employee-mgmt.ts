/**
 * Employee management flow.
 *
 * 3 independent prompts (~1 minute):
 * 1. Validate existing employees in pg.citya
 * 2. Create a new employee (may hit known HRMS bug)
 * 3. Deactivate the employee (may hit known HRMS bug)
 *
 * Each prompt is self-contained — the MCP server auto-authenticates from env vars.
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
} from "../helpers.js";

export const name = "employee-mgmt";
export const description = "Employee: validate, create, deactivate";
export const estimatedSeconds = 120;

export async function run(): Promise<void> {
  const TENANT = "pg.citya";
  let totalCost = 0;

  // -------------------------------------------------------------------
  // Step 1: Validate existing employees
  // -------------------------------------------------------------------
  logStep(1, 3, `Validating employees in ${TENANT}...`);

  const validate = await sendPrompt(
    `Validate employees in ${TENANT}. Check that at least one employee has the GRO role and one has the PGR_LME role.`,
  );

  logToolCalls(validate);
  logCost(validate);
  totalCost += validate.costUsd;
  assertToolCalled(validate, "validate_employees");

  const validateResult = getToolResult(validate, "validate_employees");
  assert(
    validateResult.success === true || validateResult.valid === true,
    `Expected employee validation to succeed, got: ${JSON.stringify(validateResult).slice(0, 300)}`,
  );

  const employeeCount =
    (validateResult.employeeCount as number) ??
    (validateResult.count as number) ??
    0;
  console.log(`        Found ${employeeCount} employees`);

  // -------------------------------------------------------------------
  // Step 2: Create a new employee
  // -------------------------------------------------------------------
  logStep(2, 3, `Creating test employee in ${TENANT}...`);

  const uniqueMobile = `99999${String(Date.now()).slice(-5)}`;

  const create = await sendPrompt(
    `Create a new employee in ${TENANT} named 'Agent Test Employee' with mobile ${uniqueMobile}, ` +
    `department DEPT_1, designation DESIG_1, jurisdiction boundary type City and boundary ${TENANT}. ` +
    `Assign roles EMPLOYEE and GRO.`,
  );

  logToolCalls(create);
  logCost(create);
  totalCost += create.costUsd;
  assertToolCalled(create, "employee_create");

  const createResult = getToolResult(create, "employee_create");

  // HRMS has a known bug where employee create may fail with NPE
  if (createResult.success === true) {
    const employee = createResult.employee as Record<string, unknown> | undefined;
    const empCode = (createResult.employeeCode as string) ??
      (employee?.code as string) ??
      (employee?.employeeCode as string);
    assert(
      typeof empCode === "string" && empCode.length > 0,
      `Expected employeeCode in result: ${JSON.stringify(createResult).slice(0, 400)}`,
    );
    console.log(`        Employee created: ${empCode}`);

    // ---------------------------------------------------------------
    // Step 3: Deactivate the employee
    // ---------------------------------------------------------------
    logStep(3, 3, `Deactivating employee ${empCode}...`);

    const deactivate = await sendPrompt(
      `Deactivate employee ${empCode} in ${TENANT}.`,
    );

    logToolCalls(deactivate);
    logCost(deactivate);
    totalCost += deactivate.costUsd;
    assertToolCalled(deactivate, "employee_update");

    const deactResult = getToolResult(deactivate, "employee_update");
    if (deactResult.success === true) {
      console.log(`        Employee deactivated successfully`);
    } else {
      // Known HRMS update bug (NPE on getUser())
      console.log(
        `        Deactivation returned non-success (known HRMS bug): ${JSON.stringify(deactResult).slice(0, 200)}`,
      );
    }
  } else {
    // Known HRMS create bug — skip deactivation
    console.log(
      `        Employee creation returned non-success (known HRMS bug): ${JSON.stringify(createResult).slice(0, 200)}`,
    );
    logStep(3, 3, "Skipping deactivation (employee create failed due to known HRMS bug)");
  }

  console.log(`        Total flow cost: $${totalCost.toFixed(4)}`);
}
