import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ERROR_CODES } from "../../src/contract/error-codes.js";
import { ROUTES } from "../../src/contract/routes.js";
import { ADMINISTRATIVE_ROLES } from "../../src/contract/roles.js";

// docs/identity-bff.md is the readable copy of src/contract/*. These tests keep
// the two identical, so neither can drift on its own.
const doc = readFileSync(join(import.meta.dirname, "../../docs/identity-bff.md"), "utf8");

function section(heading: string): string {
  const start = doc.indexOf(`\n## ${heading}`);
  if (start < 0) throw new Error(`docs/identity-bff.md has no "## ${heading}" section`);
  const end = doc.indexOf("\n## ", start + 1);
  return doc.slice(start, end < 0 ? undefined : end);
}

function tableRows(text: string): string[][] {
  return text.split("\n")
    .filter((line) => line.startsWith("| ") && !line.startsWith("|---"))
    .map((line) => line.slice(2, -2).split(" | ").map((cell) => cell.trim()))
    .slice(1);
}

describe("error-code catalogue", () => {
  const rows = tableRows(section("4. Error codes")).filter(([code]) => code?.startsWith("`"));

  it("the doc table matches src/contract/error-codes.ts exactly", () => {
    const fromDoc = Object.fromEntries(rows.map(([code, status, retry, meaning]) => [
      code!.replaceAll("`", ""),
      { status: status === "result" ? "result" : Number(status), retry, meaning },
    ]));
    expect(fromDoc).toEqual(ERROR_CODES);
  });

  it("every HTTP code is returned by at least one route, and every result code by a redirect route", () => {
    const used = new Set(ROUTES.flatMap((route) => [...route.codes, ...(route.results ?? []), ...(route.itemCodes ?? [])]));
    expect(Object.keys(ERROR_CODES).filter((code) => !used.has(code as never))).toEqual([]);
  });

  it("result codes are only delivered through auth-results, never as HTTP errors", () => {
    for (const route of ROUTES) {
      for (const code of route.codes) expect(ERROR_CODES[code].status, `${route.path} ${code}`).not.toBe("result");
    }
  });
});

describe("route catalogue", () => {
  it("the doc route table matches src/contract/routes.ts exactly", () => {
    const fromDoc = tableRows(section("3. Routes"))
      .filter((cells) => cells[0] === "GET" || cells[0] === "POST")
      .map(([method, path, , state, items]) => ({
        method,
        path: path!.replaceAll("`", ""),
        state,
        items: items === "—" ? [] : items!.replace(/\s*\(.*\)$/, "").split(", ").map(Number),
      }));
    expect(fromDoc).toEqual(ROUTES.map(({ method, path, state, items }) => ({ method, path, state, items })));
  });

  it("no route is listed twice", () => {
    const keys = ROUTES.map((route) => `${route.method} ${route.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("administrative roles", () => {
  it("the doc's _link rule lists exactly ADMINISTRATIVE_ROLES", () => {
    const rule = /codes in `ADMINISTRATIVE_ROLES` \(`src\/contract\/roles\.ts`\): ([^;]+);/.exec(section("3. Routes"))?.[1];
    expect(rule?.split(", ").map((code) => code.replaceAll("`", ""))).toEqual(ADMINISTRATIVE_ROLES);
  });
});
