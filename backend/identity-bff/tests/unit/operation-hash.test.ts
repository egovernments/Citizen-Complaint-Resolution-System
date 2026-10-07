import { describe, expect, it } from "vitest";
import {
  canonicalOrganizationPayload,
  organizationOperationHash,
} from "../../src/modules/control-plane/operation-hash.js";

// Frozen in docs/identity-bff.md §"Canonical payload hash". Cross-checked against
// Python json.dumps(sort_keys=True, separators=(",", ":"), ensure_ascii=False).
const VECTORS = [
  { payload: { tenantId: "pg", slug: "pg", name: "Punjab Gov" },
    canonical: '{"name":"Punjab Gov","slug":"pg","tenantId":"pg","v":1}',
    hash: "446418a0fc9dc46179809f79bf9c33525c197730672ecc671a2524e0e5c18427" },
  { payload: { tenantId: " pg ", slug: " PG ", name: "  Punjab \t Gov\n" },
    canonical: '{"name":"Punjab Gov","slug":"pg","tenantId":"pg","v":1}',
    hash: "446418a0fc9dc46179809f79bf9c33525c197730672ecc671a2524e0e5c18427" },
  { payload: { tenantId: "bomet", slug: "bomet-county", name: "Bomet County" },
    canonical: '{"name":"Bomet County","slug":"bomet-county","tenantId":"bomet","v":1}',
    hash: "604feff9d4a61289609e2c6cf1bfa1239710d368f0c141b33568fceba5c028b7" },
  { payload: { tenantId: "mz", slug: "maputo", name: "Conselho Municipal de Maputo — Município" },
    canonical: '{"name":"Conselho Municipal de Maputo — Município","slug":"maputo","tenantId":"mz","v":1}',
    hash: "bdd9edbfa0061469d651beb194e3d6f2d596a53ecc2deb31d36623c5b12456bc" },
  { payload: { tenantId: "pg", slug: "pg", name: "Café \"Q\"" },
    canonical: '{"name":"Café \\"Q\\"","slug":"pg","tenantId":"pg","v":1}',
    hash: "81fd40ce4409fe55af82a5bf23b3dfd0e4e818c0c00e83a027feb6a1de344bc2" },
];

describe("organizations/_ensure canonical payload hash", () => {
  it.each(VECTORS)("matches the frozen vector for $payload.slug", (vector) => {
    expect(canonicalOrganizationPayload(vector.payload)).toBe(vector.canonical);
    expect(organizationOperationHash(vector.payload)).toBe(vector.hash);
  });

  it("changes when any hashed field changes", () => {
    const base = { tenantId: "pg", slug: "pg", name: "Punjab Gov" };
    const hash = organizationOperationHash(base);
    expect(organizationOperationHash({ ...base, tenantId: "PG" })).not.toBe(hash);
    expect(organizationOperationHash({ ...base, slug: "pg2" })).not.toBe(hash);
    expect(organizationOperationHash({ ...base, name: "Punjab Govt" })).not.toBe(hash);
  });
});
