/**
 * Static contract tests for the deployment changes on this branch.
 * Pure file assertions — no running stack required — so regressions in
 * the playbook / compose / baked templates fail in CI, not on a fresh
 * tenant three deploys later.
 *
 * Each block names the incident it guards against.
 */
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

describe('default-data-handler tenant template', () => {
  // ethiopia inherited pg's Indian pincodes [143001-143005] from this
  // template, vetoing every citizen submit with
  // CS_COMMON_PINCODE_NOT_SERVICABLE. The key must stay absent: the UI
  // treats absence as "all postal codes serviceable", and mdms-v2
  // rejects pincode: [] on update. Operators seed an allowlist via the
  // tenant_bootstrap pincode_allowlist arg instead.
  test('seeds no pincode allowlist onto new tenants', () => {
    const records = JSON.parse(
      read('utilities/default-data-handler/src/main/resources/mdmsData-dev/tenant/tenant.tenants.json')
    );
    expect(Array.isArray(records)).toBe(true);
    expect(records.length).toBeGreaterThan(0);
    for (const record of records) {
      expect(record).not.toHaveProperty('pincode');
    }
  });
});

describe('ansible playbook-deploy.yml', () => {
  const playbook = read('local-setup/ansible/playbook-deploy.yml');

  // Optional per-tenant pincode allowlist (host_var pgr_pincode_allowlist)
  // must reach the MCP tenant_bootstrap on BOTH passes (root + city);
  // `default(omit)` keeps it absent — the only valid off state.
  test('both mcp-bootstrap calls forward pgr_pincode_allowlist', () => {
    const forwarded = playbook.match(
      /pincode_allowlist: "\{\{ pgr_pincode_allowlist \| default\(omit\) \}\}"/g
    );
    expect(forwarded).toHaveLength(2);
  });

  // HRMS crash-loops on non-pg tenants without the INTERNAL_USER system
  // user at state_root (its startup lookup is tenant-scoped).
  test('seeds INTERNAL_USER on state_root after bootstrap', () => {
    expect(playbook).toContain(
      'post-bootstrap — seed INTERNAL_USER system user on state_root for HRMS'
    );
    expect(playbook).toContain('userName: INTERNAL_USER');
  });

  // The HRMS prereq gate ships hardcoded to tenant pg; without the
  // rewrite HRMS waits forever for a user that lives on state_root.
  test('rewrites the HRMS prereq-gate tenant from pg to state_root', () => {
    expect(playbook).toContain(
      String.raw`'("tenantId":")pg(","roleCodes":\["INTERNAL_MICROSERVICE_ROLE"\])'`
    );
  });

  // Static mode must be able to serve a prebuilt registry bundle
  // (digit_ui_bundle_image) instead of force-resetting from the
  // (older) flywheel git checkout — which silently reverts UI fixes.
  test('supports digit_ui_bundle_image for static serving', () => {
    expect(playbook).toContain(
      'digit-ui mode=static — deploy prebuilt bundle from digit_ui_bundle_image'
    );
    // git/build path stays gated off when a bundle image is pinned
    expect(playbook).toContain("(digit_ui_bundle_image | default('')) | length == 0");
  });
});

describe('host_vars _example.yml', () => {
  test('documents the pgr_pincode_allowlist knob', () => {
    const example = read('local-setup/ansible/inventory/host_vars/_example.yml');
    expect(example).toContain('pgr_pincode_allowlist');
    expect(example).toMatch(/CS_COMMON_PINCODE_NOT_SERVICABLE/);
  });
});

describe('docker-compose.egov-digit.yaml', () => {
  const compose = read('local-setup/docker-compose.egov-digit.yaml');

  test('digit-mcp falls back to a public ghcr image', () => {
    expect(compose).toMatch(
      /image: \$\{MCP_IMAGE:-ghcr\.io\/subhashini-egov\/digit-mcp:[0-9-]+\}/
    );
  });

  test('default-data-handler image is .env-driven (DDH_IMAGE)', () => {
    expect(compose).toContain('image: ${DDH_IMAGE}');
  });
});
