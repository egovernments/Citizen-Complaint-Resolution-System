import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { expect } from "vitest";
import { ERROR_CODES, type HttpErrorCode } from "../../src/contract/error-codes.js";
import { routeContract, type RouteContract } from "../../src/contract/routes.js";

/**
 * Contract test harness (item 0). A contract test names its route with
 * `contractRoute(method, path)`; routes.test.ts finds those calls to report
 * which frozen routes still lack a contract test.
 */

const here = dirname(fileURLToPath(import.meta.url));
export const SCHEMA_DIR = join(here, "../../docs/contract/schemas");

const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
for (const file of readdirSync(SCHEMA_DIR).filter((name) => name.endsWith(".schema.json"))) {
  ajv.addSchema(JSON.parse(readFileSync(join(SCHEMA_DIR, file), "utf8")));
}

/** Schema ids are `urn:digit:identity:<name>:v1`. */
export function schemaErrors(name: string, value: unknown): string[] {
  const validate = ajv.getSchema(`urn:digit:identity:${name}:v1`);
  if (!validate) throw new Error(`unknown contract schema ${name}`);
  return validate(value) ? [] : (validate.errors ?? []).map((error) => `${error.instancePath} ${error.message}`);
}

export function expectSchema(name: string, value: unknown): void {
  expect(schemaErrors(name, value)).toEqual([]);
}

export function contractRoute(method: RouteContract["method"], path: string): RouteContract {
  const route = routeContract(method, path);
  if (!route) throw new Error(`${method} ${path} is not in src/contract/routes.ts`);
  return route;
}

/**
 * Asserts a frozen error response: the catalogue status, the `{code, error}`
 * envelope, and that the route is allowed to return this code.
 */
export async function expectContractError(
  response: Response,
  route: RouteContract,
  code: HttpErrorCode,
): Promise<Record<string, unknown>> {
  const body = await response.json() as Record<string, unknown>;
  expect(route.codes, `${route.method} ${route.path} may not return ${code}`).toContain(code);
  expect({ status: response.status, code: body.code }).toEqual({ status: ERROR_CODES[code].status, code });
  expectSchema("error-envelope", body);
  if (response.status === 429 || code === "IDENTITY_BUSY" || code === "BINDING_BUSY") {
    expect(response.headers.get("retry-after")).toMatch(/^\d+$/);
  }
  return body;
}
