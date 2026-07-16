/**
 * Lifecycle — boundary jurisdiction filter (CCRS #496 unresolved sub-bug).
 *
 * Gurjeet 2026-05-19 retest open item: "CSR can pick wards outside
 * their jurisdiction". When a CSR is scoped to a single leaf ward,
 * the `/boundary-service/boundary-relationships/_search` response
 * (used by the picker) must return ONLY that ward's subtree — not
 * the entire admin tree.
 *
 * Today this spec fails red on bomet: the API returns the full tree
 * for both ADMIN and the ward CSR. That's the honest signal — the
 * sub-bug is unresolved. The fix lives in the `boundary-service`
 * backend (filter by `requestInfo.userInfo` jurisdictions). When it
 * ships, this test goes green automatically.
 *
 * Gated on `personas.ward-scoped-csr` — required on bomet (where #496
 * is real and unresolved) and absent on maputo-local (no such persona
 * seeded there). This used to be gated on `WARD_CSR_USER`/`WARD_CSR_BOUNDARY`/
 * `FORBIDDEN_WARDS` env vars defaulting to bomet literals
 * (`BOMET_CSR_CHESOEN_1780282462` + 7 sibling ward codes). That was a
 * PROVEN false-green: on any non-bomet deployment the login 400s (skip)
 * or, worse, if it happened to log in as someone else, "no forbidden ward
 * is visible" passed VACUOUSLY — those ward codes were never heard of on
 * that deployment, so of course none of them appeared. The forbidden set
 * is now derived live from this deployment's own boundary tree, so the
 * assertion is only ever vacuous when there is nothing to derive it from
 * — and `requires()` fails/skips before that can happen silently.
 */
import { test, expect } from '@playwright/test';
import { BASE_URL, ROOT_TENANT, TENANT, ADMIN_USER, ADMIN_PASS } from '../utils/env';
import { getDigitToken } from '../utils/auth';
import { getPersona } from '../utils/personas';
import { getProfile } from '../utils/profile';
import { requires } from '../utils/capabilities';
import { fetchEmployees, fetchBoundaryTree, type BoundaryNode } from '../utils/probes';

test.describe('lifecycle — boundary jurisdiction filter for ward CSR #496', () => {
  test('boundary-relationships API returns only the ward subtree', async ({ request }) => {
    requires(test, 'personas.ward-scoped-csr');

    const profile = getProfile();
    const csr = await getPersona('ward-scoped-csr');

    // The persona only carries jurisdiction *codes* (personas.ts's
    // ResolvedPersona.jurisdictions is `string[]`) — re-read HRMS to recover
    // the boundaryType, filtering the same way personas.ts's isWardScopedCsr
    // chose this candidate: a jurisdiction row in the PGR hierarchy, below the
    // hierarchy root. An admin token reads HRMS here rather than the CSR's own
    // (HRMS employee search isn't guaranteed open to a CSR role).
    const admin = await getDigitToken({ tenant: ROOT_TENANT, username: ADMIN_USER, password: ADMIN_PASS });
    const employees = await fetchEmployees(TENANT, admin.access_token);
    const hrms = employees.find((e) => e.uuid === csr.uuid);
    const rootLevel = profile.boundary.levels[0];
    const ownJurisdiction = hrms?.jurisdictions.find(
      (j) => j.hierarchy === profile.boundary.hierarchyType && j.boundaryType !== rootLevel,
    );
    expect(
      ownJurisdiction,
      `persona 'ward-scoped-csr' (${csr.username}) resolved via isWardScopedCsr, but re-reading HRMS at ` +
        `${TENANT} found no jurisdiction matching hierarchy=${profile.boundary.hierarchyType} below root level ` +
        `'${rootLevel}' — HRMS may have changed between profile-setup and this spec running.`,
    ).toBeTruthy();
    const ownWard = ownJurisdiction!.boundary;
    const wardBoundaryType = ownJurisdiction!.boundaryType;

    // Ground truth for "every ward that exists" comes from an ADMIN read of the
    // full tree — the CSR's own response is exactly what's under test and can't
    // be trusted to enumerate the forbidden set without circularity.
    const tree = await fetchBoundaryTree(TENANT, profile.boundary.hierarchyType!, { authToken: admin.access_token });
    expect(
      tree,
      `boundary tree for ${profile.boundary.hierarchyType} at ${TENANT} must be readable to compute the forbidden ward set`,
    ).toBeTruthy();
    const forbiddenWards: string[] = [];
    const collectSiblings = (node: BoundaryNode): void => {
      if (node.boundaryType === wardBoundaryType && node.code !== ownWard) forbiddenWards.push(node.code);
      for (const child of node.children || []) collectSiblings(child);
    };
    collectSiblings(tree!);
    expect(
      forbiddenWards.length,
      `no '${wardBoundaryType}' boundaries besides ${ownWard} exist on ${TENANT} — nothing to exercise the ` +
        'jurisdiction filter against (need at least one sibling ward seeded)',
    ).toBeGreaterThan(0);

    // ============ Hit boundary-relationships as the CSR ============
    // `includeChildren=true` mirrors what the product actually sends — see
    // digit-ui-esbuild/packages/libraries/src/services/elements/Location.js and
    // products/pgr/src/hooks/pgr/useTenantBoundaries.js, which both pass it.
    // boundary-service defaults it to FALSE, which returns only the hierarchy's
    // ROOT node (for tenant `ke`, the county) and no descendants. Without it the
    // ward assertion below can never pass, and — worse — the two real #496
    // assertions (forbidden wards / bounded code count) pass VACUOUSLY against a
    // 1-element tree, so the spec silently stops guarding the regression it exists for.
    const boundaryResp = await request.post(
      `${BASE_URL}/boundary-service/boundary-relationships/_search?tenantId=${TENANT}&hierarchyType=${profile.boundary.hierarchyType}&includeChildren=true`,
      {
        headers: { 'Content-Type': 'application/json' },
        data: { RequestInfo: { authToken: csr.token } },
      },
    );
    expect(boundaryResp.ok()).toBeTruthy();
    const body = await boundaryResp.json();

    // Walk all nested `code` fields.
    const codes = new Set<string>();
    const collect = (node: unknown) => {
      if (!node || typeof node !== 'object') return;
      const obj = node as Record<string, unknown>;
      if (typeof obj.code === 'string') codes.add(obj.code);
      for (const v of Object.values(obj)) {
        if (Array.isArray(v)) v.forEach(collect);
        else if (v && typeof v === 'object') collect(v);
      }
    };
    collect(body);

    // Non-vacuity: an assertion about absence is meaningless against an empty
    // response — assert there is something here BEFORE asserting anything is
    // absent from it.
    expect(codes.size, 'response must include at least one boundary').toBeGreaterThan(0);
    expect(
      codes.has(ownWard),
      `CSR's own ward (${ownWard}) must be in the response`,
    ).toBe(true);

    // Forbidden wards — every OTHER ward on this deployment — MUST NOT appear.
    const offenders = forbiddenWards.filter((c) => codes.has(c));
    expect(
      offenders,
      `#496 — ward-scoped CSR jurisdiction filter not applied. CSR (${ownWard}) sees ${codes.size} boundaries including: ${JSON.stringify(offenders)}`,
    ).toEqual([]);

    // Total code count must be bounded — a CSR scoped to one leaf ward
    // shouldn't see the entire admin tree. Derived from the profile's own node
    // count rather than a hardcoded number, so this travels to any deployment's
    // tree size instead of assuming bomet's ~8-ward county.
    expect(
      codes.size,
      `#496 — a single-ward CSR must see fewer boundaries than the full ${profile.boundary.hierarchyType} tree ` +
        `(${profile.boundary.nodeCount} nodes); got ${codes.size}: ${JSON.stringify([...codes].slice(0, 10))}`,
    ).toBeLessThan(profile.boundary.nodeCount);
  });
});
