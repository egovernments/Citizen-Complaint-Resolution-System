import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RESERVED_URL_SLUGS, validUrlSlug } from "../../src/modules/access-context/url-slug.js";

/** The reserved list in docs/identity-bff.md §2.4.1, the source of truth. */
function documentedReservedSlugs(): string[] {
  const doc = readFileSync(fileURLToPath(new URL("../../docs/identity-bff.md", import.meta.url)), "utf8");
  const block = /<!-- reserved-url-slugs:begin -->([\s\S]*?)<!-- reserved-url-slugs:end -->/.exec(doc);
  expect(block, "docs/identity-bff.md must keep the reserved-url-slugs block").toBeTruthy();
  return block![1].split("\n").map((line) => line.trim()).filter((line) => /^[a-z0-9-]+$/.test(line));
}

describe("URL slug rules (docs §2.4.1)", () => {
  it("reserves exactly the documented slugs", () => {
    const documented = documentedReservedSlugs();
    expect(documented.length).toBeGreaterThan(10);
    expect([...RESERVED_URL_SLUGS].sort()).toEqual([...documented].sort());
  });

  it("rejects every reserved slug", () => {
    for (const slug of RESERVED_URL_SLUGS) expect(validUrlSlug(slug), slug).toBe(false);
  });

  it("requires two letters, 2-63 characters and a leading letter or digit", () => {
    for (const slug of ["a1", "1-a", "12", "a", "-bomet", "Bomet", "bo met", "b".repeat(64)]) {
      expect(validUrlSlug(slug), slug).toBe(false);
    }
    for (const slug of ["ke", "pg", "bomet-county", "county-47", "4ward", "b".repeat(63)]) {
      expect(validUrlSlug(slug), slug).toBe(true);
    }
  });
});
