import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createIdentityApp } from "../../src/app/create-app.js";
import { ROUTES } from "../../src/contract/routes.js";

/** METHOD path of every route registered on the Express app. */
function registeredRoutes(): string[] {
  const app = createIdentityApp() as unknown as { router: { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> } };
  return app.router.stack.flatMap((layer) => layer.route
    ? Object.keys(layer.route.methods).filter((method) => method !== "_all").map((method) => `${method.toUpperCase()} ${layer.route!.path}`)
    : []);
}

describe("routes in src/contract/routes.ts match the Express app", () => {
  const registered = registeredRoutes();
  const key = (route: { method: string; path: string }) => `${route.method} ${route.path}`;

  it("every registered route is in the contract", () => {
    expect(registered.filter((route) => !ROUTES.some((contract) => key(contract) === route))).toEqual([]);
  });

  it("every built route in the contract is registered", () => {
    const built = ROUTES.filter((route) => route.state !== "planned").map(key);
    expect(built.filter((route) => !registered.includes(route))).toEqual([]);
  });

  it("no planned route is registered yet (the lane that builds it moves it to changing or live)", () => {
    const planned = ROUTES.filter((route) => route.state === "planned").map(key);
    expect(planned.filter((route) => registered.includes(route))).toEqual([]);
  });
});

// Each frozen route needs a contract test that names it with
// contractRoute("METHOD", "path"). Routes without one show up as todo.
describe("contract test per frozen route", () => {
  const sources = readdirSync(import.meta.dirname)
    .filter((file) => file.endsWith(".test.ts"))
    .map((file) => readFileSync(join(import.meta.dirname, file), "utf8"))
    .join("\n");
  for (const route of ROUTES) {
    const covered = sources.includes(`contractRoute("${route.method}", "${route.path}")`);
    const title = `${route.method} ${route.path} (items ${route.items.join(", ") || "none"})`;
    if (covered) it(title, () => expect(covered).toBe(true));
    else it.todo(title);
  }
});
