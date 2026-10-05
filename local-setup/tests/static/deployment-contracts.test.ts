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
import { execFileSync } from 'child_process';

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

// #2179. Under pipefail, a consumer that stops reading early SIGPIPEs the writer and
// the pipeline reports 141 even though the consumer got what it needed. The Kong CORS
// check aborted ~half of naipepea's deploys this way. Scans every ansible YAML file
// (playbooks and included task files), not just playbook-deploy.yml.
describe('ansible: pipefail tasks never pipe into a consumer that stops reading early', () => {
  const ANSIBLE_DIR = path.join(REPO_ROOT, 'local-setup/ansible');
  const yamlFiles = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return yamlFiles(p);
      return /\.ya?ml$/.test(e.name) ? [p] : [];
    });
  // A single `|` (never `||`) into: grep with -q or -m among its flags (or --quiet /
  // --silent / --max-count), head, a sed script that quits, or an awk whose script exits.
  const EARLY_EXIT =
    /(?<!\|)\|(?!\|)\s*(?:grep\b[^|\n]*?(?:\s-[A-Za-z]*[qm][A-Za-z0-9]*\b|\s--(?:quiet|silent|max-count)\b)|head\b|sed\b[^|\n]*?(?:\bq\b|;q|q['"])|awk\b[^|\n]*?\bexit\b)/;
  const offenders = (text: string) =>
    text
      .split(/\n(?=\s*- name: )/)
      .filter((t) => /set -[a-z]*o pipefail/.test(t) && EARLY_EXIT.test(t))
      .map((t) => t.trim().split('\n')[0]);

  test('no ansible YAML file has one', () => {
    const files = yamlFiles(ANSIBLE_DIR);
    expect(files.some((f) => f.endsWith(`${path.sep}tasks${path.sep}pg-storage-guard.yml`))).toBe(true);
    const found = files.flatMap((f) =>
      offenders(fs.readFileSync(f, 'utf8')).map((name) => `${path.relative(REPO_ROOT, f)}: ${name}`)
    );
    expect(found).toEqual([]);
  });

  test('the detector catches every early-exit form and ignores || and pipefail-free tasks', () => {
    const task = (body: string, pipefail = true) =>
      `- name: t\n  shell: |\n${pipefail ? '    set -o pipefail\n' : ''}    ${body}\n`;
    for (const bad of [
      'docker ps | grep -q x',
      "x | grep -qE '^x$'",
      'x | grep -Fxq y',
      'x | grep -m1 y',
      'x | grep --quiet y',
      'find . | head -1',
      'x | head -n1',
      "x | sed -n '1p;q'",
      "x | awk -F: '{exit}'",
      'x | awk "{exit}"',
    ]) {
      expect([bad, offenders(task(bad))]).toEqual([bad, ['- name: t']]);
    }
    for (const ok of [
      'test -f x || grep -q pat file',
      'x | grep -E y',
      "x | awk '/m/{f=1} f{f=0}'",
      'x | sort | uniq',
      'grep -q pat file',
    ]) {
      expect([ok, offenders(task(ok))]).toEqual([ok, []]);
    }
    expect(offenders(task('x | grep -q y', false))).toEqual([]);
  });
});

describe('ansible playbook-deploy.yml', () => {
  const playbook = read('local-setup/ansible/playbook-deploy.yml');

  // #2088, Dhruv review finding 5. The identity tier's six secrets used to be
  // sha256(keycloak_admin_password ~ ':<label>') with `default('')`, so on a
  // box with no admin password set they all collapsed to constants computable
  // from this public repo, and any one of them leaked allowed an offline
  // brute-force of the admin password.
  describe('identity secrets are independent of the Keycloak admin password', () => {
    const IDENTITY_SECRETS = [
      'keycloak_bff_client_secret',
      'keycloak_magic_link_client_secret',
      'keycloak_admin_client_secret',
      'identity_control_plane_token',
      'identity_session_introspection_token',
      'keycloak_employee_client_secret',
      'keycloak_citizen_client_secret',
      'identity_citizen_otp_secret',
      'identity_onboarding_token',
    ];

    test('none of them is derived from another secret', () => {
      expect(playbook).not.toMatch(/keycloak_admin_password[^\n]*~ ':identity-/);
      expect(playbook).not.toMatch(/~ ':identity-[a-z-]+'\) \| hash\('sha256'\)/);
    });

    test('each is generated when absent and persisted to OpenBao', () => {
      for (const key of IDENTITY_SECRETS) {
        // generate-if-absent, short-circuiting `or` so a stored value is kept
        expect(playbook).toContain(`_identity_stored.${key} | default('', true)`);
        // and the generated value is what reaches .env
        expect(playbook).toContain(`{{ identity_secrets.${key} }}`);
      }
      // one cas-guarded, merging write, so no other key of the tenant secret
      // is dropped and a racing write is rejected rather than clobbered
      expect(playbook).toContain(
        "'cas': bao_secrets_identity.json.data.metadata.version | int"
      );
      expect(playbook).toContain(
        'bao_secrets_identity.json.data.data | combine(identity_secrets)'
      );
    });

    // 8c gate report 4, Part A: the digit-ui surface secrets, the phone-OTP
    // HMAC secret and the onboarding bearer were documented but never
    // generated or passed, so a converged box skipped the digit-ui clients
    // and answered 503 on employee/citizen sign-in.
    test('the digit-ui surface secrets reach the Keycloak configurator', () => {
      const start = playbook.indexOf('identity-bootstrap — reconcile Organizations realm and BFF clients');
      expect(start).toBeGreaterThan(-1);
      const task = playbook.slice(start, start + 4000);
      for (const [env, key] of [
        ['KEYCLOAK_EMPLOYEE_CLIENT_SECRET', 'keycloak_employee_client_secret'],
        ['KEYCLOAK_CITIZEN_CLIENT_SECRET', 'keycloak_citizen_client_secret'],
      ]) {
        expect(task).toContain(`${env}: "{{ identity_secrets.${key} }}"`);
        expect(playbook).toContain(`${env}={{ identity_secrets.${key} }}`);
      }
      expect(playbook).toContain('IDENTITY_CITIZEN_OTP_SECRET={{ identity_secrets.identity_citizen_otp_secret }}');
      expect(playbook).toContain('IDENTITY_ONBOARDING_TOKEN={{ identity_secrets.identity_onboarding_token }}');
    });

    test('an empty Keycloak admin password fails the deploy closed', () => {
      // Empty here is not neutral: compose falls back to the literal `admin`.
      expect(playbook).toContain(
        "(bao_secrets_identity.json.data.data.keycloak_admin_password | default('', true)) | length > 0"
      );
      // ...and .env takes the asserted value, not a `| default('')` of it
      expect(playbook).toContain(
        'KC_ADMIN_PASSWORD={{ bao_secrets_identity.json.data.data.keycloak_admin_password }}'
      );
    });
  });

  // #2088, Dhruv review finding 6. The `/kc` route, the per-tenant realm and
  // its `digit-ui` client are gone, and D26 removed the frontend code that read
  // `auth_provider`, so a host_vars still saying `keycloak` is refused.
  test('refuses to deploy a frontend still pointed at the removed Keycloak login', () => {
    const start = playbook.indexOf('_keycloak_login_surfaces:');
    expect(start).toBeGreaterThan(-1);
    const task = playbook.slice(start, start + 2000);
    // all three resolution keys are covered, including the two per-surface
    // overrides that do not simply inherit auth_provider
    for (const key of ['auth_provider', 'citizen_auth_provider', 'employee_auth_provider']) {
      expect(task).toContain(`'${key}':`);
    }
    expect(task).toContain("selectattr('value', 'eq', 'keycloak')");
    expect(playbook).toContain('when: _keycloak_login_surfaces | length > 0');
  });

  // Optional per-tenant pincode allowlist (host_var pgr_pincode_allowlist)
  // must reach the MCP tenant_bootstrap on BOTH passes (root + city);
  // `default(omit)` keeps it absent — the only valid off state.
  test('both mcp-bootstrap calls forward pgr_pincode_allowlist', () => {
    const forwarded = playbook.match(
      /pincode_allowlist: "\{\{ pgr_pincode_allowlist \| default\(omit\) \}\}"/g
    );
    expect(forwarded).toHaveLength(2);
  });

  test('both 0→1 bootstrap passes forward the dashboard access role floor', () => {
    const forwarded = playbook.match(
      /dashboard_roles: "\{\{ dashboard_allowed_roles \}\}"/g
    );
    expect(forwarded).toHaveLength(2);
  });

  // HRMS crash-loops on non-pg tenants without the INTERNAL_USER system
  // user at state_root (its startup lookup is tenant-scoped).
  //
  // Asserts the BEHAVIOUR, not the task's display name. This test originally
  // pinned the exact task title and the payload's YAML form; c0a21204 rewrote
  // the task as a retrying curl POST — on the same day the test landed — and
  // broke both assertions without changing what they were protecting.
  //
  // Scoped to the request payload rather than scanning the whole playbook.
  // Three loose `toContain` calls would pass if userName and tenantId lived in
  // two unrelated tasks — they would prove both strings exist somewhere, not
  // that INTERNAL_USER is created AT state_root, which is the actual invariant.
  // Parsing the one payload that mentions INTERNAL_USER checks the fields
  // together, and survives task renames, field reordering and whitespace.
  test('seeds INTERNAL_USER on state_root after bootstrap', () => {
    // The Jinja expressions sit inside JSON string values, so the body is
    // still valid JSON — `{{ state_root }}` parses as a plain string.
    const payloads = [...playbook.matchAll(/body='(\{.*?\})'\s*$/gm)]
      .map((m) => m[1])
      .filter((b) => b.includes('INTERNAL_USER'));

    // Exactly one — two would mean a duplicate seed path, and this test would
    // silently only be covering whichever came first.
    expect(payloads).toHaveLength(1);

    const user = JSON.parse(payloads[0]).User;
    expect(user.userName).toBe('INTERNAL_USER');
    expect(user.tenantId).toBe('{{ state_root }}');
    // SYSTEM is what makes HRMS's startup lookup accept it.
    expect(user.type).toBe('SYSTEM');
    // The role is tenant-scoped too; on `pg` it would not satisfy the lookup.
    const roleTenants = (user.roles as Array<{ tenantId: string }>).map((r) => r.tenantId);
    expect(roleTenants).toEqual(['{{ state_root }}']);
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

  test('documents current dashboard access and excludes the legacy path', () => {
    const example = read('local-setup/ansible/inventory/host_vars/_example.yml');
    expect(example).toContain('dashboard_allowed_roles');
    expect(example).toContain('base analytics capabilities');
    expect(example).toContain('/dashboard path is outside this bootstrap contract');
  });
});
describe('host_vars templates — db_fast_path ack (#2082)', () => {
  const HOST_VARS = 'local-setup/ansible/inventory/host_vars';
  // Tracked templates only. Operator host_vars (<tenant>.yml) are gitignored
  // and SHOULD carry ack: true once that box has been checked — asserting on
  // them would fail on the deploying engineer's own machine.
  const templates = fs
    .readdirSync(path.join(REPO_ROOT, HOST_VARS))
    .filter((f) => f.endsWith('.yml.example') || f === '_example.yml');

  test.each(templates)('%s never ships a pre-set data-wipe ack', (file) => {
    const body = read(path.join(HOST_VARS, file));
    if (!/^db_fast_path:\s*true/m.test(body)) return; // flag off: ack is moot
    expect(body).toMatch(/^db_fast_path_ack_data_wipe:\s*false\s*$/m);
    expect(body).not.toMatch(/^db_fast_path_ack_data_wipe:\s*true/m);
  });

  test('preflight still fails _example.yml for exactly that reason', () => {
    // preflight exits non-zero here by design, so execFileSync always throws and
    // the output arrives on the error. Record whether it exited 0 rather than
    // throwing from inside the try, which would land in this same catch and be
    // reported as a confusing assertion failure instead of the real message.
    let out = '';
    let exitedZero = false;
    try {
      out = execFileSync('python3',
        ['local-setup/scripts/preflight.py', `${HOST_VARS}/_example.yml`],
        { cwd: REPO_ROOT, encoding: 'utf8' });
      exitedZero = true;
    } catch (e: any) {
      out = e.stdout ?? '';
    }
    expect(exitedZero).toBe(false); // _example.yml must NOT pass preflight
    const fails = out.split('\n').filter((l) => l.startsWith('[FAIL]'));
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain('fastpath-data-wipe-ack');
  });
});

// Dhruv, #2271 review 3, item 1: three example host_vars still set
// `enable_digit_ui_v2: true`, which the playbook has refused since D26, and the
// static tests stayed green because preflight.py mirrored neither D26 refusal.
// Every tracked example now goes through preflight.py. The fast-path rules are
// the only ones allowed to fire: every example ships db_fast_path with the
// data-wipe ack off on purpose (#2082), and the non-dump examples carry a
// placeholder master password. Anything else is a copy-and-deploy trap.
describe('example host_vars pass preflight.py (#2271)', () => {
  const HOST_VARS = 'local-setup/ansible/inventory/host_vars';
  const BY_DESIGN = new Set(['fastpath-data-wipe-ack', 'fastpath-master-password']);
  const templates = fs
    .readdirSync(path.join(REPO_ROOT, HOST_VARS))
    .filter((f) => f.endsWith('.yml.example') || f === '_example.yml')
    .sort();

  const preflight = (file: string) => {
    try {
      return execFileSync('python3', ['local-setup/scripts/preflight.py', `${HOST_VARS}/${file}`],
        { cwd: REPO_ROOT, encoding: 'utf8' });
    } catch (e: any) {
      return e.stdout ?? '';
    }
  };

  test('covers every tracked example', () => {
    expect(templates).toEqual(expect.arrayContaining([
      '_example.yml', 'bomet.yml.example', 'localhost-full.yml.example',
      'localhost-slim.yml.example', 'maputo.yml.example', 'quickstart.yml.example',
    ]));
  });

  test.each(templates)('%s trips no rule beyond the fast-path ack', (file) => {
    const out = preflight(file);
    expect(out).toContain(`── preflight: ${HOST_VARS}/${file}`);
    const unexpected = out.split('\n')
      .filter((l: string) => l.startsWith('[FAIL]'))
      .filter((l: string) => !BY_DESIGN.has(l.slice('[FAIL] '.length).split(':')[0]));
    expect(unexpected).toEqual([]);
  });

  test('preflight.py mirrors both D26 refusals in the playbook', () => {
    const script = read('local-setup/scripts/preflight.py');
    const playbook = read('local-setup/ansible/playbook-deploy.yml');
    expect(playbook).toContain('- name: "preflight — identity requires enable_keycloak: true"');
    expect(playbook).toContain('- name: "preflight — refuse retired digit-ui-v2 citizen identity"');
    expect(script).toMatch(/"identity-needs-keycloak"/);
    expect(script).toMatch(/"digit-ui-v2-retired"/);
    const selfTest = execFileSync('python3', ['local-setup/scripts/preflight.py', '--self-test'],
      { cwd: REPO_ROOT, encoding: 'utf8' });
    expect(selfTest).toContain('[self-test ok ] enable_keycloak false fires');
    expect(selfTest).toContain('[self-test ok ] enable_digit_ui_v2 true fires');
  });
});

// issue #2111. ansible.cfg sets `executable = /bin/bash` so `set -o pipefail`
// works on Debian/Ubuntu targets, where /bin/sh is dash. Ansible ALSO derives
// the shell PLUGIN name from that basename, and ships none called "bash" — so
// every ansible.posix.synchronize task fails with "Could not find the shell
// plugin required (bash)". playbook-deploy.yml has 12 of them and the first is
// ~100 tasks in, so a deploy dies with the host already part-configured.
//
// Asserted here rather than in an Ansible playbook because the failure needs a
// real SSH connection to reproduce: over a local connection the plugin is never
// loaded, so an offline playbook passes with or without the fix (verified).
describe('ansible.cfg — executable has a matching shell plugin (#2111)', () => {
  const CFG = 'local-setup/ansible/ansible.cfg';
  const BUILTIN = ['sh', 'csh', 'fish', 'powershell', 'cmd'];

  test('every configured executable resolves to a shell plugin', () => {
    const cfg = read(CFG);
    const m = cfg.match(/^\s*executable\s*=\s*(\S+)/m);
    if (!m) return; // no override, Ansible's default `sh` applies
    const name = path.basename(m[1]);
    if (BUILTIN.includes(name)) return;

    // Not built in, so the repo must ship one — NEXT TO THE PLAYBOOK.
    //
    // Asserted against the playbook directory, not a config key: `shell_plugins`
    // is not an Ansible setting (no such entry in `ansible-config list`, and
    // shell_loader.config is the hardcoded literal ['shell_plugins'] resolved
    // against the process CWD). ansible-playbook calls
    // add_all_plugin_dirs(playbook_dir), so <playbook_dir>/shell_plugins is what
    // is actually searched. Keying this test on a cfg line would let someone
    // move the directory, update that line, and keep a green build while every
    // synchronize task broke again.
    const pluginDir = path.join(path.dirname(path.join(REPO_ROOT, CFG)), 'shell_plugins');
    expect(fs.existsSync(path.join(pluginDir, `${name}.py`))).toBe(true);
  });
});

describe('one-tag deploys (#1729)', () => {
  // `./deploy.sh <tenant> --image-tag=<tag>` moves every image listed in
  // group_vars ccrs_image_catalog to <tag>. An image the deploy runs but the
  // catalog misses would silently stay on its old default under a deploy
  // everyone believes is on the new tag — the manual per-service edit this
  // flow replaced, just invisible. These pin the three places that must agree.
  const groupVars = read('local-setup/ansible/inventory/group_vars/digit.yml');
  const envTemplate = read('local-setup/ansible/templates/digit.env.j2');
  const deploySh = read('local-setup/ansible/deploy.sh');
  // The compose files the playbook passes to every `docker compose` call.
  const deployedCompose = [
    'local-setup/docker-compose.egov-digit.yaml',
    'local-setup/docker-compose.fast-path.yml',
    'local-setup/docker-compose.migrations.yml',
    'local-setup/docker-compose.monitoring.yml',
    'local-setup/docker-compose.matomo.yml',
  ].map((f) => [f, read(f)] as const);

  const catalog = [...groupVars.matchAll(/^  - \{image: ([\w-]+), env: (\w+), var: (\w+)/gm)]
    .map(([, image, env, v]) => ({ image, env, var: v }));
  const ciImages = new Set(
    [...read('build/build-config.yml').matchAll(/image-name:\s*"?([\w.-]+)"?/g)].map((m) => m[1])
  );

  test('the catalog parses and names only images CI publishes under one tag', () => {
    expect(catalog.length).toBeGreaterThanOrEqual(12);
    for (const { image } of catalog) expect(ciImages).toContain(image);
  });

  test('every catalog image is parameterised in a deployed compose file', () => {
    for (const { image, env } of catalog) {
      const pattern = new RegExp(`image: \\$\\{${env}:-egovio/${image}:[^}]+\\}`);
      const hits = deployedCompose.filter(([, body]) => pattern.test(body));
      expect({ image, found: hits.length > 0 }).toEqual({ image, found: true });
    }
  });

  test('no CI-built image in a deployed compose file escapes the catalog', () => {
    const catalogued = new Set(catalog.map((c) => c.image));
    const escaped: string[] = [];
    for (const [file, body] of deployedCompose) {
      for (const m of body.matchAll(/^\s*image:\s*(.+)$/gm)) {
        const ref = m[1].trim();
        const bare = ref.match(/^egovio\/([\w.-]+):/);
        const wrapped = ref.match(/^\$\{(\w+):-egovio\/([\w.-]+):/);
        if (bare && ciImages.has(bare[1])) escaped.push(`${file}: ${ref} (hardcoded)`);
        if (wrapped && ciImages.has(wrapped[2]) && !catalogued.has(wrapped[2])) {
          escaped.push(`${file}: ${ref} (not in ccrs_image_catalog)`);
        }
      }
    }
    expect(escaped).toEqual([]);
  });

  test('catalog `profiles` match the compose profiles each image runs under', () => {
    // The registry check skips an image whose profiles are all off (Vinoth
    // review on #2166). A catalog entry claiming a profile compose does not
    // gate would skip a check for an image that IS pulled; one missing a
    // profile would block deploys on an image that is never pulled.
    const composeProfiles = new Map<string, { gated: Set<string>; ungated: boolean }>();
    for (const [, body] of deployedCompose) {
      const blocks = body.split(/^(?=  [\w.-]+:\s*$)/m);
      for (const block of blocks) {
        const env = block.match(/^ {4}image:\s*\$\{(\w+):-/m)?.[1];
        if (!env) continue;
        const listed = block.match(/^ {4}profiles:\s*\[([^\]]*)\]/m)?.[1];
        const entry = composeProfiles.get(env) ?? { gated: new Set<string>(), ungated: false };
        if (listed === undefined) entry.ungated = true;
        else listed.split(',').map((p) => p.trim().replace(/"/g, '')).forEach((p) => entry.gated.add(p));
        composeProfiles.set(env, entry);
      }
    }
    const entries = [...groupVars.matchAll(/^  - \{image: ([\w-]+), env: (\w+),([^}]*)\}/gm)];
    expect(entries).toHaveLength(catalog.length);
    for (const [, image, env, rest] of entries) {
      const declared = (rest.match(/profiles: \[([^\]]*)\]/)?.[1] ?? '')
        .split(',').map((p) => p.trim()).filter(Boolean).sort();
      const inCompose = composeProfiles.get(env);
      const expected = !inCompose || inCompose.ungated ? [] : [...inCompose.gated].sort();
      expect({ image, profiles: declared }).toEqual({ image, profiles: expected });
    }
  });

  test('digit.env.j2 writes every catalog env var from the resolved plan, once', () => {
    expect(envTemplate).toContain('{% for e in ccrs_image_catalog %}');
    expect(envTemplate).toContain('{{ e.env }}={{ ccrs_image_env[e.env] }}');
    // A second hand-written line would be a duplicate .env key (last one wins)
    // and could quietly undo the tag.
    for (const { env } of catalog) expect(envTemplate).not.toMatch(new RegExp(`^${env}=`, 'm'));
  });

  test('deploy.sh forwards --image-tag / --image-tag-services as extra vars', () => {
    expect(deploySh).toMatch(/--image-tag=\*\)/);
    expect(deploySh).toMatch(/--image-tag-services=\*\)/);
    expect(deploySh).toContain('\\"image_tag\\": \\"${image_tag}\\"');
    // Only what was given: an always-sent `image_tag_services: []` outranked
    // and widened a scope stored in host_vars (Vinoth review on #2166).
    expect(deploySh).not.toContain('\\"image_tag_services\\": []');
    // CCRS_-scoped env names: a bare IMAGE_TAG exported by a CI docker step
    // re-tagged every image of a plain deploy.
    expect(deploySh).toContain('${CCRS_IMAGE_TAG:-}');
    expect(deploySh).toContain('${CCRS_IMAGE_TAG_SERVICES:-}');
    expect(deploySh).not.toMatch(/\$\{IMAGE_TAG(_SERVICES)?:-/);
  });

  test('no tracked tenant overlay hard-codes an image the tag should move', () => {
    // The playbook layers docker-compose.<tenant>.yml LAST, so a literal
    // `image:` there on a catalog service beats .env: the plan would say
    // <tag> while compose ran something else (Vinoth review on #2166). The
    // deploy warns for untracked overlays at runtime; tracked ones must not
    // do it at all. A tenant overlay is one whose name has a host_vars example.
    const serviceEnv = new Map<string, string>();
    const catalogEnvs = new Set(catalog.map((c) => c.env));
    for (const [, body] of deployedCompose) {
      for (const block of body.split(/^(?=  [\w.-]+:\s*$)/m)) {
        const name = block.match(/^  ([\w.-]+):\s*$/m)?.[1];
        const env = block.match(/^ {4}image:\s*\$\{(\w+):-/m)?.[1];
        if (name && env && catalogEnvs.has(env)) serviceEnv.set(name, env);
      }
    }
    expect(serviceEnv.get('pgr-services')).toBe('PGR_SERVICES_IMAGE');
    const hostVarsDir = path.join(REPO_ROOT, 'local-setup/ansible/inventory/host_vars');
    const tenants = fs.readdirSync(hostVarsDir)
      .map((f) => f.match(/^([\w-]+)\.yml\.example$/)?.[1])
      .filter((t): t is string => !!t);
    const overlays = tenants
      .map((t) => `local-setup/docker-compose.${t}.yml`)
      .filter((f) => fs.existsSync(path.join(REPO_ROOT, f)));
    expect(overlays.length).toBeGreaterThan(0);
    const hardCoded: string[] = [];
    for (const f of overlays) {
      for (const block of read(f).split(/^(?=  [\w.-]+:\s*$)/m)) {
        const name = block.match(/^  ([\w.-]+):\s*$/m)?.[1];
        const image = block.match(/^ {4}image:\s*(\S+)/m)?.[1];
        if (name && image && serviceEnv.has(name) && !image.startsWith('${')) {
          hardCoded.push(`${f}: ${name} -> ${image} (use \${${serviceEnv.get(name)}})`);
        }
      }
    }
    expect(hardCoded).toEqual([]);
  });
});

describe('docker-compose.egov-digit.yaml', () => {
  const compose = read('local-setup/docker-compose.egov-digit.yaml');
  const composeEnv = read('local-setup/ansible/templates/digit.env.j2');

  test('digit-mcp falls back to the image this repo publishes', () => {
    // egovio/digit-mcp is what build/build-config.yml builds from
    // digit-mcp/Dockerfile. It used to fall back to a personal ghcr registry
    // fed by a different repository, so changes made here never shipped.
    expect(compose).toMatch(
      /image: \$\{MCP_IMAGE:-egovio\/digit-mcp:[\w.-]+\}/
    );
  });

  test('digit-mcp does NOT relax auth — nginx proxies /v1/ publicly', () => {
    // ansible/templates/nginx-site.conf.j2 exposes /v1/ on the public vhost and
    // relies on the MCP server to authenticate. MCP_AUTH_MODE=ambient here
    // would therefore publish an anonymous ADMIN surface.
    expect(compose).not.toMatch(/MCP_AUTH_MODE:\s*\$\{MCP_AUTH_MODE:-ambient\}/);
    expect(compose).not.toMatch(/MCP_AUTH_MODE:\s*ambient/);
  });

  test('Kong preserves host nginx client addresses for BFF rate limiting', () => {
    expect(compose).toContain('KONG_TRUSTED_IPS: ${KONG_TRUSTED_IPS:-');
    expect(compose).toContain('KONG_REAL_IP_HEADER: X-Forwarded-For');
    expect(compose).toContain('KONG_REAL_IP_RECURSIVE: "on"');
    expect(composeEnv).toContain('KONG_TRUSTED_IPS={{ kong_trusted_ips | default(');
  });
});

describe('tenant-scoped digit-ui routing', () => {
  const nginx = read('local-setup/ansible/templates/nginx-site.conf.j2');
  const helmTenantIngress = read(
    'devops/deploy-as-code/charts/urban/digit-ui/templates/tenant-ingress.yaml'
  );
  const imageNginx = read('digit-ui-esbuild/docker/nginx.conf');

  // nginx `$1` → JS replacement for a match.
  const substitute = (target: string, match: RegExpExecArray) =>
    target.replace(/\$(\d)/g, (_, n) => match[Number(n)] ?? '');

  // Compose: the two regex locations, in config order (nginx takes the first
  // matching regex). Case-sensitive, as `location ~`.
  const composeRoutes = [...nginx.matchAll(
    /location ~ "(\^\/[^"]*digit-ui[^"]*)" \{\s*(?:return 302 (\S+);|rewrite "[^"]+" (\S+) last;)/g
  )].map((m) => ({ re: new RegExp(m[1]), redirect: m[2], internal: m[3] }));
  // Helm: ingress-nginx renders each path as `location ~* "^<path>"`
  // (case-insensitive) and orders longer paths first.
  const helmRoutes = [...helmTenantIngress.matchAll(/"path" "([^"]+)" "rewrite" "([^"]+)"/g)]
    .map((m) => ({ path: m[1], re: new RegExp(`^${m[1]}`, 'i'), internal: m[2] }))
    .sort((a, b) => b.path.length - a.path.length);
  // The digit-ui image's nginx answers the internal tenant-root path.
  const imageRedirects = [...imageNginx.matchAll(/location ~ "([^"]+)" \{[^}]*?return 302 (\S+);/g)]
    .map((m) => ({ re: new RegExp(m[1]), redirect: m[2] }));

  const compose = (uri: string) => {
    for (const route of composeRoutes) {
      const m = route.re.exec(uri);
      if (m) return route.redirect ? { redirect: substitute(route.redirect, m) } : { internal: substitute(route.internal!, m) };
    }
    return null;
  };
  const helm = (uri: string) => {
    for (const route of helmRoutes) {
      const m = route.re.exec(uri);
      if (!m) continue;
      const internal = substitute(route.internal, m);
      for (const image of imageRedirects) {
        const r = image.re.exec(internal);
        if (r) return { redirect: substitute(image.redirect, r) };
      }
      return { internal };
    }
    return null;
  };

  test('the configs parse into the expected routes', () => {
    expect(composeRoutes).toHaveLength(2);
    expect(helmRoutes).toHaveLength(2);
    expect(imageRedirects).toHaveLength(1);
    // Quoted: an unquoted `{2,63}` makes nginx read the `{` as a block opener (#2127).
    expect(nginx).toContain('location ~ "^/[a-z0-9-]{2,63}/digit-ui/(.*)$" {');
    // Without absolute_redirect off the image would send the ingress's http://pod-host.
    expect(imageNginx).toMatch(/absolute_redirect off;\s*return 302/);
  });

  test.each([
    ['/bomet-county/digit-ui', { redirect: '/bomet-county/digit-ui/' }],
    ['/bomet-county/digit-ui/', { internal: '/digit-ui/' }],
    ['/bomet-county/digit-ui/employee/pgr/inbox', { internal: '/digit-ui/employee/pgr/inbox' }],
    ['/ke/digit-ui/citizen/login', { internal: '/digit-ui/citizen/login' }],
    ['/digit-ui/employee', null],
    ['/x/digit-ui/', null],
    ['/bomet-county/digit-uix', null],
  ])('Compose nginx and Kubernetes ingress agree on %s', (uri, expected) => {
    expect(compose(uri)).toEqual(expected);
    expect(helm(uri)).toEqual(expected);
  });

  test('case sensitivity differs and is documented in the chart', () => {
    // ingress-nginx always matches regex paths with `~*`; Compose uses `~`.
    // Both end on a not-found page because the SPA only accepts lower-case slugs.
    expect(compose('/Bomet-County/digit-ui/')).toBeNull();
    expect(helm('/Bomet-County/digit-ui/')).toEqual({ internal: '/digit-ui/' });
    expect(helmTenantIngress).toMatch(/case-INsensitively/);
  });

  test('Kubernetes ingress keeps the chart annotations on both tenant ingresses', () => {
    expect(helmTenantIngress).toContain('$root.Values.ingress.annotations');
    expect(helmTenantIngress).toContain('$root.Values.ingress.waf.annotations');
    expect(helmTenantIngress).toContain('$root.Values.ingress.additionalAnnotations');
  });
});

describe('Keycloak realm proxy client address', () => {
  // Deliberately NOT $proxy_add_x_forwarded_for: Keycloak takes the leftmost
  // X-Forwarded-For entry, so appending would let a caller choose the IP that
  // brute-force detection records. Behind an LB, use nginx realip instead.
  const nginx = read('local-setup/ansible/templates/nginx-site.conf.j2');
  const loop = /\{% for keycloak_path in \[([^\]]+)\] %\}\n  location \^~ \{\{ keycloak_path \}\} \{([\s\S]*?)\n  \}\n\{% endfor %\}/.exec(nginx);

  test('/auth/realms/ and /auth/resources/ set X-Forwarded-For to the peer address', () => {
    expect(loop).not.toBeNull();
    expect(loop![1]).toBe("'/auth/realms/', '/auth/resources/'");
    expect(loop![2]).toContain('proxy_set_header X-Forwarded-For $remote_addr;');
    expect(loop![2]).not.toContain('$proxy_add_x_forwarded_for');
    expect(nginx).toMatch(/set_real_ip_from[\s\S]{0,200}\{% for keycloak_path in/);
  });

  // #2271 review 3, item 3: the stock Novu dashboard claims `location /auth/`,
  // which caught Keycloak's theme assets at /auth/resources/ and broke the
  // login page on any box that ran both. The Keycloak locations are longer
  // `^~` prefixes, so nginx picks them over /auth/ (verified by rendering the
  // template into nginx:alpine with stock Novu + Keycloak).
  test('Keycloak public paths win over the stock Novu dashboard /auth/ catch-all', () => {
    const stock = nginx.slice(nginx.indexOf('# Novu dashboard (SPA) — STOCK image.'));
    expect(stock).toMatch(/\n  location \/auth\/ \{\n    proxy_pass http:\/\/127\.0\.0\.1:14000;/);
    expect(nginx.indexOf('{% if enable_keycloak | default(false) %}\n  # Keycloak\'s public surface'))
      .toBeGreaterThan(-1);
    expect(nginx).not.toContain('unsafe to combine with Keycloak');
    const playbook = read('local-setup/ansible/playbook-deploy.yml');
    expect(playbook).toContain("nginx routes Keycloak's /auth/realms/ and\n          /auth/resources/ ahead of the stock dashboard's /auth/ paths");
    expect(playbook).not.toContain('until the frontend cutover');
  });
});

describe('reserved tenant URL slugs (identity-bff docs §2.4.1)', () => {
  const doc = read('backend/identity-bff/docs/identity-bff.md');
  const block = /<!-- reserved-url-slugs:begin -->([\s\S]*?)<!-- reserved-url-slugs:end -->/.exec(doc);
  const reserved = new Set(
    (block?.[1] ?? '').split('\n').map((line) => line.trim()).filter((line) => /^[a-z0-9-]+$/.test(line))
  );
  const slugShaped = (segment: string) => /^[a-z0-9-]{2,63}$/.test(segment);

  test('the contract doc carries the list', () => {
    expect(block).not.toBeNull();
    expect(reserved.size).toBeGreaterThan(10);
  });

  test('every top-level nginx location prefix is reserved', () => {
    const nginx = read('local-setup/ansible/templates/nginx-site.conf.j2');
    const prefixes = [...nginx.matchAll(/^\s*location\s+(?:=|\^~)?\s*\/([A-Za-z0-9_.-]+)/gm)]
      .map((m) => m[1]).filter(slugShaped);
    expect(prefixes.length).toBeGreaterThan(10);
    expect(prefixes.filter((p) => !reserved.has(p))).toEqual([]);
  });

  test('every top-level Kong route prefix is reserved', () => {
    const kong = read('local-setup/kong/kong.yml');
    const prefixes = [...kong.matchAll(/^\s*paths:\s*\n((?:\s*-\s*\S+\s*\n)+)/gm)]
      .flatMap((m) => [...m[1].matchAll(/-\s*~?\^?\/([A-Za-z0-9_.-]+)/g)].map((p) => p[1]))
      .filter(slugShaped);
    expect(prefixes.length).toBeGreaterThan(10);
    expect([...new Set(prefixes)].filter((p) => !reserved.has(p))).toEqual([]);
  });

  test('the SPA reserves exactly the documented list', () => {
    const spa = read('digit-ui-esbuild/packages/libraries/src/services/tenant/tenantRoute.js');
    const list = /RESERVED_TENANT_SLUGS = Object\.freeze\(\[([\s\S]*?)\]\)/.exec(spa);
    expect(list).not.toBeNull();
    const spaSlugs = [...list![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
    expect(spaSlugs).toEqual([...reserved].sort());
  });

  const globalConfig = read('local-setup/ansible/templates/globalConfigs.js.j2');
  const helmGlobalConfig = read(
    'devops/deploy-as-code/charts/urban/digit-ui/files/globalConfigs.js.tpl'
  );

  test('tenant selection is no longer deployment global configuration', () => {
    expect(globalConfig).not.toContain('SHOW_TENANT_SWITCHER');
    expect(globalConfig).not.toContain('LOGIN_TENANT_ALLOWLIST');
    expect(helmGlobalConfig).not.toContain('LOGIN_TENANT_ALLOWLIST');
  });

  test('globalConfigs contain no browser auth-provider or direct-Keycloak keys', () => {
    const removed = ['AUTH_PROVIDER', 'KEYCLOAK_URL', 'KEYCLOAK_REALM',
      'KEYCLOAK_CLIENT_ID', 'TOKEN_EXCHANGE_URL', 'authProvider',
      'keycloakUrl', 'keycloakRealm', 'keycloakClientId', 'tokenExchangeUrl'];
    const sources = {
      'globalConfigs.js.j2': globalConfig,
      'helm globalConfigs.js.tpl': helmGlobalConfig,
      'helm values.yaml': read('devops/deploy-as-code/charts/urban/digit-ui/values.yaml'),
      'digit-ui-esbuild dev stub': read('digit-ui-esbuild/public/globalConfigs.js'),
      'local-setup nginx stub': read('local-setup/nginx/globalConfigs.js'),
    };
    for (const [name, body] of Object.entries(sources)) {
      for (const key of removed) {
        expect({ name, key, found: body.includes(key) }).toEqual({ name, key, found: false });
      }
    }
  });
});

describe('Novu workflow creation deployment contract', () => {
  const novuValues = read('devops/deploy-as-code/charts/backbone-services/novu/values.yaml');
  const dashboardValues = novuValues.slice(novuValues.lastIndexOf('\ndashboard:'));
  const novuIngress = read('devops/deploy-as-code/charts/backbone-services/novu/templates/ingress.yaml');
  // NB: composeEnv is the ANSIBLE TEMPLATE that writes /opt/digit/.env, not the
  // compose file. composeFile is the compose file. Asserting the first alone
  // proves only that a value is written down, never that a container gets it.
  const composeEnv = read('local-setup/ansible/templates/digit.env.j2');
  const composeFile = read('local-setup/docker-compose.egov-digit.yaml');
  const playbookFile = read('local-setup/ansible/playbook-deploy.yml');
  const composeNginx = read('local-setup/ansible/templates/nginx-site.conf.j2');
  const novuEnv = read('backend/novu-bridge/config/.env.novu');
  const novuBootstrap = read('backend/novu-bridge/config/bootstrap-novu-whatsapp.sh');
  const dotenvLoader = path.join(
    REPO_ROOT,
    'backend/novu-bridge/config/load-dotenv.sh'
  );

  test('Helm gives browser code public API/WS URLs rather than cluster-only service names', () => {
    expect(novuValues).toContain('publicOrigin: "https://domain.com"');
    expect(novuValues).toContain('value: {{ printf "%s/novu-api" .Values.ingress.publicOrigin | quote }}');
    expect(novuValues).toContain('value: {{ .Values.ingress.publicOrigin | quote }}');
    // The worker correctly uses an in-cluster API URL; only values injected
    // into browser JavaScript must be public.
    expect(dashboardValues).not.toContain('value: {{ printf "http://%s:%d" .Values.api.name');
    expect(dashboardValues).not.toContain('value: {{ printf "http://%s:%d" .Values.ws.name');
  });

  test('Helm exposes API, websocket, and stock-dashboard absolute SPA routes', () => {
    expect(novuIngress).toContain('.Values.ingress.api.path');
    expect(novuIngress).toContain('.Values.ingress.ws.path');
    expect(novuIngress).toContain('range list "/env"');
    expect(novuIngress).toContain('"/auth/sign-in"');
    expect(novuIngress).toContain('"/integrations"');
    expect(novuIngress).toContain('"/assets"');
    expect(novuIngress).toContain('path: "/socket.io"');
    expect(novuIngress).toContain('name: {{ .Values.ingress.ws.service.name }}');
  });

  test('Compose routes Novu Socket.IO at the root path its 2.3.0 client actually uses', () => {
    expect(composeEnv).toContain(
      "NOVU_WS_PUBLIC_URL={{ novu_ws_public_url | default(novu_public_origin) }}"
    );
    expect(composeNginx).toContain('location /socket.io/');
    expect(composeNginx).toContain('proxy_pass http://127.0.0.1:14003/socket.io/;');
  });

  test('the tracked SMS body is quoted and dotenv loading preserves spaces and explicit env', () => {
    expect(novuEnv).toContain(
      "NOVU_SMS_BODY='Complaint {{payload.complaintNo}} status is {{payload.status}}'"
    );

    const probe = String.raw`
      set -euo pipefail
      source "$1"
      load_dotenv_defaults <(printf '%s\n' 'NOVU_SMS_BODY=Complaint {{payload.complaintNo}} status is {{payload.status}}')
      printf '%s\n' "$NOVU_SMS_BODY"
      NOVU_SMS_BODY='caller wins'
      load_dotenv_defaults <(printf '%s\n' 'NOVU_SMS_BODY=file loses')
      printf '%s\n' "$NOVU_SMS_BODY"
    `;
    const output = execFileSync('bash', ['-c', probe, 'bash', dotenvLoader], {
      encoding: 'utf8',
    }).trim().split('\n');

    expect(output).toEqual([
      'Complaint {{payload.complaintNo}} status is {{payload.status}}',
      'caller wins',
    ]);
  });

  test('the bootstrap preserves Handlebars braces in the default SMS body and explicit overrides', () => {
    const smsBodyDefault = novuBootstrap.match(
      /if \[\[ -z "\$\{NOVU_SMS_BODY:-\}" \]\]; then\n  NOVU_SMS_BODY='[^'\n]*'\nfi/
    );
    expect(smsBodyDefault).not.toBeNull();

    const probe = `${smsBodyDefault![0]}\nprintf '%s\\n' "$NOVU_SMS_BODY"`;
    const runProbe = (override?: string) => {
      const env = { ...process.env };
      if (override === undefined) {
        delete env.NOVU_SMS_BODY;
      } else {
        env.NOVU_SMS_BODY = override;
      }
      return execFileSync('bash', ['-c', probe], {
        encoding: 'utf8',
        env,
      }).trim();
    };

    expect(runProbe()).toBe(
      'Complaint {{payload.complaintNo}} status is {{payload.status}}'
    );
    expect(runProbe('Custom {{payload.status}} update')).toBe(
      'Custom {{payload.status}} update'
    );
  });

  // Nothing triggers the legacy COMPLAINTS.WORKFLOW.* workflows: the bridge resolves
  // its Novu workflow from the channel (NovuBridgeConfiguration.getNovuWorkflowId),
  // never from the event name. The playbook runs this script with only the Twilio
  // vars set, so a non-empty default here silently creates them on every deploy.
  test('the bootstrap creates no event-convention workflows unless asked', () => {
    expect(novuBootstrap).toContain('NOVU_EVENT_WORKFLOWS="${NOVU_EVENT_WORKFLOWS:-}"');

    const probe = [
      'NOVU_EVENT_WORKFLOWS="${NOVU_EVENT_WORKFLOWS:-}"',
      'IFS="," read -r -a IDS <<< "$NOVU_EVENT_WORKFLOWS"',
      'n=0',
      'for i in "${IDS[@]}"; do i="$(echo "$i" | xargs)"; [[ -z "$i" ]] && continue; n=$((n+1)); done',
      'printf "%s\\n" "$n"',
    ].join('\n');

    const countCreated = (override?: string) => {
      const env = { ...process.env };
      if (override === undefined) {
        delete env.NOVU_EVENT_WORKFLOWS;
      } else {
        env.NOVU_EVENT_WORKFLOWS = override;
      }
      return execFileSync('bash', ['-c', probe], { encoding: 'utf8', env }).trim();
    };

    expect(countCreated()).toBe('0');
    // The comma idiom older runbooks used must keep working.
    expect(countCreated(',')).toBe('0');
    expect(countCreated('A.B,C.D')).toBe('2');
  });

  // Ansible rendering a variable into /opt/digit/.env is NOT enough: Compose reads
  // .env for ${...} interpolation only, so a variable the novu-bridge service does
  // not declare never reaches the container. That gap shipped once — the bridge
  // silently fell back to the Novu path and SMS never reached SMSCountry — because
  // the test only checked the template. Assert both halves of the handover.
  // bootstrap-novu-whatsapp.sh does two unrelated jobs: register the Twilio
  // PROVIDER, and create the per-channel WORKFLOWS every deployment needs
  // whichever gateway sends. Gating the whole task on twilio_account_sid left a
  // non-Twilio tenant with zero workflows and Novu answering workflow_not_found.
  // The bootstrap sources ${SCRIPT_DIR}/load-dotenv.sh. Copying only the script
  // made it exit 1 on a fresh box before creating anything — silently, because the
  // run task is failed_when:false. Existing boxes hid it: workflows already in the
  // Novu mongo volume survive redeploys.
  // Defaulting the channel list to SMS,EMAIL meant a deployment that never set it
  // attempted email dispatch with no SMTP provider onboarded, failing silently on
  // every complaint. Nothing is dispatched now until an operator names a channel.
  test('no channel is dispatched by default', () => {
    expect(composeFile).toContain('NOVU_BRIDGE_CHANNELS_ENABLED: ${NOVU_BRIDGE_CHANNELS_ENABLED:-}');
    expect(composeEnv).toContain(
      "NOVU_BRIDGE_CHANNELS_ENABLED={{ novu_bridge_channels_enabled | default('') }}"
    );
    expect(composeFile).not.toContain('NOVU_BRIDGE_CHANNELS_ENABLED:-SMS');
  });

  test('the bootstrap ships with the helper it sources', () => {
    const sourced = novuBootstrap.match(/source "\$\{SCRIPT_DIR\}\/([a-z-]+\.sh)"/);
    expect(sourced).not.toBeNull();
    expect(playbookFile).toContain(`backend/novu-bridge/config/${sourced![1]}`);
  });

  // Novu derives the stored workflowId from the NAME and ignores the workflowId in
  // the payload, so a friendly name yields an id novu-bridge never triggers.
  test('the WhatsApp workflow name defaults to its id', () => {
    expect(novuBootstrap).toContain(
      'NOVU_WORKFLOW_NAME="${NOVU_WORKFLOW_NAME:-$NOVU_WORKFLOW_ID}"'
    );
    expect(novuBootstrap).not.toContain('Complaints WhatsApp Workflow}"');
  });

  test('channel-workflow creation is not gated on Twilio', () => {
    const task = playbookFile.slice(
      playbookFile.indexOf('novu-bootstrap — copy bootstrap script'),
      playbookFile.indexOf('changed_when: "\'created\' in')
    );
    expect(task.length).toBeGreaterThan(0);
    expect(task).not.toMatch(/when:[\s\S]*?\(twilio_account_sid \| default\(''\)\) \| length > 0/);

    // The sandbox default must not leak in when no SID is set: the script reads
    // any Twilio value as "Twilio configured" and then demands all three, which
    // would fail the run and reopen the gap.
    expect(task).toContain(
      'if (twilio_account_sid | default("")) | length > 0 else ""'
    );
  });

  test('the legacy direct SMSCountry settings are rendered AND handed to the container', () => {
    const vars = [
      'NOVU_BRIDGE_SMS_PROVIDER',
      'NOVU_BRIDGE_SMS_SENDER_ID',
      'NOVU_BRIDGE_SMSCOUNTRY_URL',
      'NOVU_BRIDGE_SMSCOUNTRY_USER',
      'NOVU_BRIDGE_SMSCOUNTRY_PASSWORD',
    ];

    // half 1: ansible writes them into the env file
    for (const v of vars) {
      expect(composeEnv).toContain(`${v}=`);
    }

    // half 2: the novu-bridge service declares them, so they reach the process
    // from the novu-bridge key to the next service key at the same indent
    const start = composeFile.indexOf('\n  novu-bridge:');
    expect(start).toBeGreaterThan(-1);
    const rest = composeFile.slice(start + 1);
    const next = rest.search(/\n {2}[a-z0-9-]+:\n/);
    const bridgeBlock = next === -1 ? rest : rest.slice(0, next);
    expect(bridgeBlock).toContain('novu-bridge:');
    for (const v of vars) {
      expect(bridgeBlock).toContain(`${v}: \${${v}`);
    }

    // the direct route is a client of its own, not a Novu integration
    expect(composeEnv).not.toContain('NOVU_BRIDGE_SMS_INTEGRATION_IDENTIFIER');
  });

  // The bridge-side SMSCountry adapter (and its apiUrl allow-list) is gone: settings for
  // it would be dead config that reads as if something still consumed it.
  test('no bridge-side gateway adapter settings are left', () => {
    for (const text of [composeFile, composeEnv]) {
      expect(text).not.toContain('SMSCOUNTRY_ALLOWED_HOSTS');
      expect(text).not.toContain('SMSCOUNTRY_ADAPTER');
    }
  });

  // SMSCountry / Ozeki / Jasmin are DIGIT's providers, mounted into the STOCK Novu worker
  // (backend/novu-bridge/novu-worker-providers). Without the mount and the preload their
  // integrations save and every send through them fails inside Novu while the bridge
  // records SENT, so each link of the chain is pinned here.
  const PROVIDERS_SRC = 'backend/novu-bridge/novu-worker-providers';
  const PROVIDERS_CHART = 'devops/deploy-as-code/charts/backbone-services/novu/files/novu-worker-providers';
  const runtimeFiles = (dir: string) =>
    fs.readdirSync(path.join(REPO_ROOT, dir)).filter((f) => f.endsWith('.js')).sort();
  const taskBody = (name: string) => {
    const at = playbookFile.indexOf(`- name: "${name}"`);
    expect(at).toBeGreaterThan(-1);
    const next = playbookFile.indexOf('\n    - name:', at + 1);
    return playbookFile.slice(at, next === -1 ? undefined : next);
  };

  test('compose runs the stock Novu worker and mounts + preloads DIGIT providers', () => {
    const start = composeFile.indexOf('\n  novu-worker:');
    expect(start).toBeGreaterThan(-1);
    const rest = composeFile.slice(start + 1);
    const next = rest.search(/\n {2}[a-z0-9-]+:\n/);
    const workerBlock = next === -1 ? rest : rest.slice(0, next);
    expect(workerBlock).toMatch(/^ {4}image: ghcr\.io\/novuhq\/novu\/worker:2\.3\.0$/m);
    expect(workerBlock).toMatch(/^ {6}NODE_OPTIONS: --require \/opt\/digit-novu-providers\/register\.js$/m);
    // Vinoth re-review 4141822062: any node process in the worker registers the providers or
    // crashes, so a wrapper or a moved entrypoint cannot start a worker without them.
    expect(workerBlock).toMatch(/^ {6}DIGIT_NOVU_PROVIDERS: required$/m);
    expect(workerBlock).toMatch(
      /^ {6}- \$\{NOVU_WORKER_PROVIDERS_DIR:-\.\.\/backend\/novu-bridge\/novu-worker-providers\}:\/opt\/digit-novu-providers:ro$/m
    );
    // The compose default is relative to local-setup/ and must land on the real directory.
    expect(fs.existsSync(path.join(REPO_ROOT, 'local-setup', '../backend/novu-bridge/novu-worker-providers/register.js'))).toBe(true);
    expect(composeEnv).toMatch(/^NOVU_WORKER_PROVIDERS_DIR=\{\{ digit_dir \}\}\/novu-worker-providers$/m);
  });

  test('the deploy stages the providers before the stack starts and restarts the worker when they change', () => {
    const stage = taskBody('Novu worker providers — stage on target');
    expect(stage).toContain('enable_novu');
    expect(stage).toContain(`src: "../../${PROVIDERS_SRC}/"`);
    expect(stage).toContain('dest: "{{ digit_dir }}/novu-worker-providers/"');
    expect(stage).toContain('delete: true');
    expect(stage).toContain('register: novu_worker_providers_sync');
    expect(playbookFile.indexOf('Novu worker providers — stage on target')).toBeLessThan(
      playbookFile.indexOf('- name: Start DIGIT stack (Linux/Debian)')
    );

    const restart = taskBody('Novu worker — restart when its mounted providers changed');
    expect(restart).toContain('docker restart novu-worker');
    expect(restart).toContain('novu_worker_providers_sync is changed');
  });

  // helm can only read files inside the chart, so the chart carries a copy. It must be
  // the same code, or k8s and compose would send differently.
  test('the helm chart ships the same provider code and mounts + preloads it', () => {
    expect(runtimeFiles(PROVIDERS_CHART)).toEqual(runtimeFiles(PROVIDERS_SRC));
    expect(runtimeFiles(PROVIDERS_SRC)).toEqual(['jasmin.js', 'novu.js', 'ozeki.js', 'register.js', 'smscountry.js']);
    for (const file of runtimeFiles(PROVIDERS_SRC)) {
      expect(read(`${PROVIDERS_CHART}/${file}`)).toBe(read(`${PROVIDERS_SRC}/${file}`));
    }

    const workerTemplate = read('devops/deploy-as-code/charts/backbone-services/novu/templates/worker/worker-deployment.yaml');
    expect(workerTemplate).toContain('value: "--require /opt/digit-novu-providers/register.js"');
    // inside the same digitProviders.enabled block as NODE_OPTIONS
    expect(workerTemplate).toMatch(
      /- name: NODE_OPTIONS\n\s+value: "--require \/opt\/digit-novu-providers\/register\.js"\n(\s+#[^\n]*\n)?\s+- name: DIGIT_NOVU_PROVIDERS\n\s+value: "required"\n\s+\{\{- end \}\}/);
    expect(workerTemplate).toContain('mountPath: /opt/digit-novu-providers');
    expect(workerTemplate).toContain('checksum/digit-providers');
    expect(read('devops/deploy-as-code/charts/backbone-services/novu/templates/worker/worker-providers-configmap.yaml')).toContain(
      '.Files.Glob "files/novu-worker-providers/*.js"'
    );
    expect(novuValues).toMatch(/^ {2}digitProviders:\n {4}enabled: true$/m);
    expect(novuValues).toMatch(/^ {4}repository: "ghcr\.io\/novuhq\/novu\/worker"\n {4}tag: "2\.3\.0"$/m);
  });

  // M1 (re-review): novu-bridge must know whether the worker preloads those providers
  // (NOVU_BRIDGE_DIGIT_WORKER_PROVIDERS), and it must come from the SAME switch as the mount,
  // or the two can disagree and the bridge offers providers whose every send fails.
  test('the bridge is told whether the worker preloads DIGIT providers, from the mount switch', () => {
    const start = composeFile.indexOf('\n  novu-bridge:');
    const rest = composeFile.slice(start + 1);
    const next = rest.search(/\n {2}[a-z0-9-]+:\n/);
    const bridgeBlock = next === -1 ? rest : rest.slice(0, next);
    // Compose mounts + preloads unconditionally (pinned above), so the bridge is told "true", literally.
    expect(bridgeBlock).toMatch(/^ {6}NOVU_BRIDGE_DIGIT_WORKER_PROVIDERS: 'true'$/m);

    expect(read('devops/deploy-as-code/charts/environments/env.yaml')).toMatch(/^ {2}novuWorkerDigitProviders: true$/m);
    const helmfile = read('devops/deploy-as-code/charts/backbone-services/backboneservices-helmfile.yaml');
    expect(helmfile).toContain(
      'enabled: {{ if hasKey .Values.global "novuWorkerDigitProviders" }}{{ .Values.global.novuWorkerDigitProviders }}{{ else }}true{{ end }}');
    const bridgeValues = read('devops/deploy-as-code/charts/common-services/novu-bridge/values.yaml');
    expect(bridgeValues).toMatch(
      /- name: NOVU_BRIDGE_DIGIT_WORKER_PROVIDERS\n {4}value: \{\{ if hasKey \(\.Values\.global \| default dict\) "novuWorkerDigitProviders" \}\}\{\{ \.Values\.global\.novuWorkerDigitProviders /);
    expect(bridgeValues).toMatch(/^digit-worker-providers: true$/m);
  });

  // Provider admin calls are allowed only for admins of the owning state (the state root of
  // NOVU_BRIDGE_CORE_SMS_DEFAULT_TENANT) plus NOVU_BRIDGE_PROVIDER_ADMIN_TENANTS.
  test('the provider-owning tenant is state_root, checked on the running bridge, and extra admin tenants are plumbed', () => {
    const start = composeFile.indexOf('\n  novu-bridge:');
    const bridgeBlock = composeFile.slice(start, composeFile.indexOf('\n  # ====', start));
    expect(bridgeBlock).toContain('NOVU_BRIDGE_PROVIDER_ADMIN_TENANTS: ${NOVU_BRIDGE_PROVIDER_ADMIN_TENANTS:-}');
    expect(composeEnv).toContain("NOVU_BRIDGE_PROVIDER_ADMIN_TENANTS={{ novu_bridge_provider_admin_tenants | default('') }}");
    expect(read('local-setup/ansible/inventory/host_vars/_example.yml')).toMatch(/^# novu_bridge_provider_admin_tenants: /m);
    expect(read('devops/deploy-as-code/charts/common-services/novu-bridge/values.yaml')).toContain(
      '- name: NOVU_BRIDGE_PROVIDER_ADMIN_TENANTS');

    const readTenant = taskBody('novu-bootstrap — read the OTP / provider-owning tenant novu-bridge runs with');
    expect(readTenant).toContain("sed -n 's/^NOVU_BRIDGE_CORE_SMS_DEFAULT_TENANT=//p'"); // never the whole env: it holds secrets
    const fail = taskBody('novu-bootstrap — fail: novu-bridge does not run with state_root as its OTP / provider-owning tenant');
    expect(fail).toContain("(bridge_core_tenant.stdout | default('') | trim) != state_root");
    expect(playbookFile.indexOf('novu-bootstrap — read the OTP / provider-owning tenant')).toBeGreaterThan(
      playbookFile.indexOf('novu-bootstrap — recreate novu-bridge so it picks up NOVU_API_KEY'));
  });

  // The fork (a custom-built worker image) was retired for the mounted providers.
  test('nothing deploys or documents the retired Novu fork worker', () => {
    const hostVarsExample = read('local-setup/ansible/inventory/host_vars/_example.yml');
    for (const text of [composeFile, composeEnv, playbookFile, novuValues, hostVarsExample]) {
      for (const stale of ['NOVU_WORKER_IMAGE', 'novu_worker_image', 'dhruv-1001/novu', '2.3.0-digit']) {
        expect(text).not.toContain(stale);
      }
    }
  });

  // These were documented as "add them to /opt/digit/.env by hand" — and every deploy
  // regenerates that file from digit.env.j2, so the receipts secret, the consent gate
  // and the OTP country code silently reverted on the next deploy.
  test('the bridge settings an operator sets survive a redeploy', () => {
    const vars = [
      'NOVU_BRIDGE_RECEIPTS_SECRET',
      'NOVU_BRIDGE_PREFERENCE_ENABLED',
      'NOVU_BRIDGE_PREFERENCE_FAIL_OPEN',
      'NOVU_BRIDGE_CORE_SMS_COUNTRY_CODE',
      'NOVU_BRIDGE_PROVIDER_ADMIN_TENANTS',
    ];
    const start = composeFile.indexOf('\n  novu-bridge:');
    const rest = composeFile.slice(start + 1);
    const next = rest.search(/\n {2}[a-z0-9-]+:\n/);
    const bridgeBlock = next === -1 ? rest : rest.slice(0, next);
    for (const v of vars) {
      expect(composeEnv).toMatch(new RegExp(`^${v}=\\{\\{ `, 'm'));
      expect(bridgeBlock).toContain(`${v}: \${${v}`);
    }
  });
});

describe('notification stack images come from one build', () => {
  // pgr-services emits thin events only a novu-bridge of the same build resolves (an
  // older bridge dead-letters them), and each app needs the Flyway migrations its -db
  // image carries. The migrator used to be hard-pinned to 2.12 while the app image was
  // overridable, so a new bridge ran on the old schema and every ledger write failed.
  const base = read('local-setup/docker-compose.egov-digit.yaml');
  const migrations = read('local-setup/docker-compose.migrations.yml');
  const env = read('local-setup/ansible/templates/digit.env.j2');

  const CHARTS = [
    'devops/deploy-as-code/charts/urban/pgr-services',
    'devops/deploy-as-code/charts/common-services/novu-bridge',
  ];
  // The app image (top-level `image:`) and the Flyway image (initContainers.dbMigration
  // .image) of a chart, read from its values.yaml by layout (no YAML parser is a declared
  // dependency here). A null means the layout moved: fix the pattern, do not drop the test.
  const chartImages = (dir: string) => {
    const v = read(`${dir}/values.yaml`);
    const app = v.match(/^image:\n {2}repository: "[^"]+"\n {2}tag: "([^"]+)"[^\n]*\n {2}pullPolicy: (\S+)/m);
    const db = v.match(/^ {4}image:\n {6}repository: "[^"]+-db"\n {6}tag: "([^"]+)"[^\n]*\n {6}pullPolicy: (\S+)/m);
    expect(app).not.toBeNull();
    expect(db).not.toBeNull();
    return { app: { tag: app![1], pullPolicy: app![2] }, db: { tag: db![1], pullPolicy: db![2] } };
  };
  const images: Array<[string, string, string]> = [
    [base, 'PGR_SERVICES_IMAGE', 'egovio/pgr-services'],
    [base, 'NOVU_BRIDGE_IMAGE', 'egovio/novu-bridge'],
    [migrations, 'PGR_SERVICES_DB_IMAGE', 'egovio/pgr-services-db'],
    [migrations, 'NOVU_BRIDGE_DB_IMAGE', 'egovio/novu-bridge-db'],
  ];
  // The default tag of one image line: ${OVERRIDE:-<image>:${NOTIFICATION_STACK_TAG:-<tag>}}.
  const composeDefault = (file: string, override: string, image: string) => {
    const m = file.match(new RegExp(
      `image: \\$\\{${override}:-${image.replace(/[/.]/g, '\\$&')}:\\$\\{NOTIFICATION_STACK_TAG:-([^}]+)\\}\\}`));
    return m ? m[1] : null;
  };

  // Each override is written to .env by the one-tag image catalog (#1729): its env var
  // must be a catalog entry, and digit.env.j2 must render every catalog entry.
  const catalog = read('local-setup/ansible/inventory/group_vars/digit.yml');
  test.each(images)('%#: %s defaults to the shared NOTIFICATION_STACK_TAG', (file, override, image) => {
    expect(composeDefault(file, override, image)).not.toBeNull();
    expect(catalog).toMatch(new RegExp(`\\{image: [\\w-]+, env: ${override}, var: \\w+`));
    expect(env).toContain('{{ e.env }}={{ ccrs_image_env[e.env] }}');
  });

  // The release step (build/NIGHTLY-BUILDS.md) swaps the stopgap rolling default for an
  // immutable develop-<sha8> in SIX places — four compose lines and two charts. Bumping
  // only some of them is exactly the split build this block exists to prevent.
  test('all four images default to ONE tag, in compose and in both Helm charts', () => {
    const tags = new Set(images.map(([file, override, image]) => composeDefault(file, override, image)));
    for (const dir of CHARTS) {
      const { app, db } = chartImages(dir);
      tags.add(app.tag);
      tags.add(db.tag);
    }
    expect([...tags]).toHaveLength(1);
  });

  test('the shared tag is rendered from host_vars', () => {
    expect(env).toContain("NOTIFICATION_STACK_TAG={{ notification_stack_tag | default('') }}");
  });

  // Kanav/Vinoth review of #2097: the charts pulled a rolling tag with Always while
  // env.yaml forced `nightly-develop` over any chart pin. The charts now default to
  // IfNotPresent and switch to Always only for a rolling tag, and env.yaml leaves the tag
  // to the charts unless a deployment pins one.
  test.each(CHARTS)('%s pulls IfNotPresent unless the tag is rolling', (chartDir) => {
    const { app, db } = chartImages(chartDir);
    expect(app.pullPolicy).toBe('IfNotPresent');
    expect(db.pullPolicy).toBe('IfNotPresent');
    const tpl = read(`${chartDir}/templates/deployment.yaml`);
    expect(tpl).toContain('regexMatch "^(latest|nightly-.*|develop|main|master)$"');
    expect(tpl).toContain('$_ := set $img "pullPolicy" "Always"');
  });

  test('env.yaml does not force a rolling notificationStackTag over the chart pins', () => {
    const m = read('devops/deploy-as-code/charts/environments/env.yaml').match(/^ {2}notificationStackTag: "([^"]*)"/m);
    expect(m).not.toBeNull();
    expect(m![1]).not.toMatch(/^(latest|nightly-.*|develop|main|master)$/);
  });
});

describe('tenant-master repair is report-only unless opted in', () => {
  // Kanav review of #2097 (4079418087): the repair ran with APPLY=1 by default on every
  // non-pg deploy, so a live tenant that deliberately withheld grants got pg's back.
  const playbook = read('local-setup/ansible/playbook-deploy.yml');
  const script = read('local-setup/scripts/repair-tenant-masters.py');

  test('the playbook writes only for repair_tenant_masters: true', () => {
    expect(playbook).toContain(`APPLY: "{{ '1' if (repair_tenant_masters | default(false) | bool) else '0' }}"`);
    expect(playbook).not.toMatch(/APPLY[=:] *"?1"?\s*$/m);
    expect(playbook).not.toMatch(/repair_tenant_masters \| default\(true\)/);
  });

  test('the script itself defaults to report-only', () => {
    expect(script).toContain('APPLY = os.environ.get("APPLY", "0")');
  });

  test('RBAC_BLOCKED fails the deploy only on an opted-in run', () => {
    const task = playbook.slice(playbook.indexOf('master-repair — fail when the tenant cannot be repaired'));
    const when = task.slice(0, task.indexOf('ansible.builtin.fail'));
    expect(when).toContain('repair_tenant_masters | default(false) | bool');
  });

  test('a restart of egov-accesscontrol is followed by a readiness wait', () => {
    const restart = playbook.indexOf('master-repair — restart egov-accesscontrol');
    const wait = playbook.indexOf('master-repair — wait for egov-accesscontrol to come back');
    expect(restart).toBeGreaterThan(-1);
    expect(wait).toBeGreaterThan(restart);
    expect(playbook.slice(wait, wait + 600)).toContain('/access/health');
  });
});

// Kanav review of #2097, second round.
describe('notification deploy tasks (Kanav review of #2097, round 2)', () => {
  const playbook = read('local-setup/ansible/playbook-deploy.yml');
  /** The text of the task named `name` (up to the next task at the same indent). */
  const task = (name: string) => {
    const start = playbook.indexOf(`- name: "${name}`);
    expect(start).toBeGreaterThan(-1);
    const next = playbook.indexOf('\n    - name:', start + 1);
    return playbook.slice(start, next === -1 ? undefined : next);
  };

  // 4079418204: the retired OTP senders were removed AFTER the main `up -d`, so for the
  // whole stack start egov-notification-sms and the new novu-bridge both consumed
  // egov.core.notification.sms and every login OTP went out twice.
  // 4118608332 (re-review): removing them before the up on a box with NO bridge yet left
  // nothing consuming the topic for the whole start (OTPs dropped), and a failed up left
  // the box with no OTP sender at all.
  // Vinoth 4141822018: a failed `up -d novu-bridge` was swallowed (pipefail, no -e) and the
  // OLD bridge, still running, printed BRIDGE-RUNNING. 4141822022: "running" is not "consuming":
  // CoreSmsConsumer starts at the END of the topic when its group has no committed offset there.
  // So: the bridge-first step fails on a failed up and names only the CURRENT container, and both
  // removals wait for the handoff (core-sms-handoff.sh — run for real in
  // local-setup/tests/test_core_sms_handoff.py).
  test('the retired OTP senders go only once a current novu-bridge has taken over the OTP topic', () => {
    const bridgeFirst = playbook.indexOf('- name: "notification stack — recreate novu-bridge before pgr-services');
    const early = playbook.indexOf('- name: "notification stack — remove the retired OTP senders now');
    const mainStart = playbook.indexOf('- name: Start DIGIT stack (Linux/Debian)');
    const late = playbook.indexOf('- name: "notification stack — remove the retired OTP senders once novu-bridge took over the OTP topic');
    const pull = playbook.indexOf('- name: Pull all images from VPC registry');
    const stage = playbook.indexOf('- name: "Copy the core-SMS handoff check"');
    expect(pull).toBeGreaterThan(-1);
    expect(stage).toBeGreaterThan(-1);
    expect(stage).toBeLessThan(bridgeFirst);
    expect(bridgeFirst).toBeGreaterThan(pull);
    expect(early).toBeGreaterThan(bridgeFirst);
    expect(mainStart).toBeGreaterThan(early);
    expect(late).toBeGreaterThan(mainStart);
    expect(task('Copy the core-SMS handoff check')).toContain('src: ../scripts/core-sms-handoff.sh');

    const first = task('notification stack — recreate novu-bridge before pgr-services');
    expect(first).toMatch(/if ! dc up -d novu-bridge 2>&1 \| tee -a \{\{ compose_progress_file \}\}; then\n[\s\S]*?exit 1\n/);
    // Vinoth 4154544380: "is the running bridge current" lives in core-sms-handoff.sh only
    // (run for real against both callers in test_core_sms_handoff.py)
    expect(first).toContain('source "{{ digit_dir }}/core-sms-handoff.sh"');
    expect(first).toContain('CSH_COMPOSE="COMPOSE_PROFILES={{ compose_profiles }} docker compose {{ compose_files }}"');
    expect(first.indexOf('core_sms_bridge_current')).toBeGreaterThan(first.indexOf('if ! dc up -d novu-bridge'));
    expect(first.indexOf('core_sms_bridge_current')).toBeLessThan(first.indexOf('echo "BRIDGE-RUNNING'));
    expect(first).toMatch(/\n\s+RUNNING\)\n\s+echo "BRIDGE-RUNNING /);
    expect(first).toMatch(/\*\)\n\s+echo "BRIDGE-NOT-CURRENT[\s\S]*?exit 1 ;;/);
    const helper = read('local-setup/scripts/core-sms-handoff.sh');
    const enableSh = read('local-setup/scripts/enable-notifications.sh');
    const code = (src: string) => src.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    // `config --images <svc>` lists the dependencies' images too: the one service's image is read
    expect(helper).toContain('_csh_compose config --format json "$svc"');
    expect(helper).toContain('_csh_compose config --hash "$svc"');
    expect(helper).toContain('[ "${have%|*}" != "$want_id|$want_hash" ]');
    expect(code(helper)).not.toContain('config --images');
    for (const src of [playbook, enableSh]) {
      expect(code(src)).not.toMatch(/config --hash|config --format json novu-bridge|com\.docker\.compose\.config-hash/);
    }

    const earlyTask = task('notification stack — remove the retired OTP senders now');
    expect(earlyTask).toContain('enable_novu | default(false)');
    expect(earlyTask).toContain('- bridge_first is changed');
    expect(earlyTask).toContain(`- "'BRIDGE-RUNNING' in (bridge_first.stdout | default(''))"`);
    expect(earlyTask).toContain('source "{{ digit_dir }}/core-sms-handoff.sh"');
    expect(earlyTask.indexOf('if ! core_sms_wait_handoff 30 10; then')).toBeLessThan(earlyTask.indexOf('docker rm -f'));
    expect(earlyTask).toMatch(/if ! core_sms_wait_handoff 30 10; then\n\s+echo "DEFERRED:/);
    expect(earlyTask).toContain('"$svc|{{ digit_dir }}"');
    expect(earlyTask).toContain('register: retired_notification_containers\n');

    const lateTask = task('notification stack — remove the retired OTP senders once novu-bridge took over the OTP topic');
    expect(lateTask).toContain('(retired_notification_containers is skipped)');
    expect(lateTask).toContain("or ('DEFERRED:' in (retired_notification_containers.stdout | default('')))");
    expect(lateTask).toContain('enable_novu | default(false)');
    // no handoff keeps them
    expect(lateTask).toMatch(/if ! core_sms_wait_handoff 60 10; then\n\s+echo "KEPT:/);
    expect(lateTask.indexOf('core_sms_wait_handoff')).toBeLessThan(lateTask.indexOf('docker rm -f'));
    expect(lateTask).toContain('"$svc|{{ digit_dir }}"');
    expect(task('notification stack — WARNING: the retired OTP senders were kept')).toContain(
      "'KEPT:' in (retired_notification_containers_late.stdout | default(''))");
  });

  test('enable-notifications.sh removes the retired OTP senders only once the bridge has taken over', () => {
    const sh = read('local-setup/scripts/enable-notifications.sh');
    const body = (fn: string) => {
      const start = sh.indexOf(`\n${fn}() {`);
      expect(start).toBeGreaterThan(-1);
      return sh.slice(start, sh.indexOf('\n}\n', start));
    };
    const step1 = body('do_step1');
    expect(step1.indexOf('compose up -d novu-bridge-migration novu-bridge')).toBeLessThan(step1.indexOf('_bridge_is_current'));
    expect(step1.indexOf('_bridge_is_current')).toBeLessThan(step1.indexOf('_remove_retired_after_handoff 30'));
    expect(step1).not.toContain('_remove_retired_notification_containers');
    const step2 = body('do_step2');
    expect(step2).not.toContain('_remove_retired_notification_containers');
    expect(step2.indexOf('compose up -d novu-mongo')).toBeLessThan(step2.indexOf('_remove_retired_after_handoff 60'));
    const wait = body('_remove_retired_after_handoff');
    expect(wait.indexOf('if ! core_sms_wait_handoff "$tries" 10; then')).toBeLessThan(wait.indexOf('_remove_retired_notification_containers'));
    const lib = body('_core_sms_handoff_lib');
    expect(lib).toContain('core-sms-handoff.sh');
    expect(lib).toContain('CSH_COMPOSE="$DC"');
    expect(lib).toContain('CSH_COMPOSE_DIR="$DIGIT_HOME"');
    // Vinoth 4154544380: the shared check, not a second copy of it
    const current = body('_bridge_is_current');
    expect(current.indexOf('_core_sms_handoff_lib')).toBeLessThan(current.indexOf('core_sms_bridge_current'));
    expect(current).not.toContain('docker');
  });

  // Vinoth 4154544371: the compose file is copied with `NOVU_BRIDGE_CORE_SMS_DEFAULT_TENANT: pg`.
  // Rewritten only post-bootstrap, the upgrade's bridge-first recreate started novu-bridge with
  // pg, the handoff removed egov-notification-sms, and every tenant-less OTP until the late
  // recreate was checked against pg and dropped (SKIPPED / NB_NO_PROVIDER) on a non-pg box.
  test('the OTP default tenant is state_root before anything starts novu-bridge from the copied compose file', () => {
    const at = (name: string) => {
      const i = playbook.indexOf(`- name: ${name}`);
      expect(i).toBeGreaterThan(-1);
      return i;
    };
    const copy = at('Copy registry-prefixed Docker Compose file');
    const early = at('"Set NOVU_BRIDGE_CORE_SMS_DEFAULT_TENANT (state-root) in compose before any container starts"');
    const bridgeFirst = at('"notification stack — recreate novu-bridge before pgr-services');
    const mainStart = at('Start DIGIT stack (Linux/Debian)');
    const macStart = at('"Start DIGIT stack (macOS/Rosetta');
    const late = at('"post-bootstrap — set NOVU_BRIDGE_CORE_SMS_DEFAULT_TENANT (state-root) in compose"');
    expect(early).toBeGreaterThan(copy);
    expect(early).toBeLessThan(bridgeFirst);
    expect(early).toBeLessThan(mainStart);
    expect(early).toBeLessThan(macStart);
    expect(late).toBeGreaterThan(mainStart);
    // nothing between the copy and the rewrite starts a container
    expect(playbook.slice(copy, early)).not.toMatch(/docker compose[^\n]*\bup\b/);
    // the same rewrite as the post-bootstrap backstop, which then finds nothing to change
    const rewrite = (t: string) => t.slice(t.indexOf('path:'), t.indexOf('replace: ') + 200).split('\n').slice(0, 3).join('\n');
    const earlyTask = task('Set NOVU_BRIDGE_CORE_SMS_DEFAULT_TENANT (state-root) in compose before any container starts');
    const lateTask = task('post-bootstrap — set NOVU_BRIDGE_CORE_SMS_DEFAULT_TENANT (state-root) in compose');
    expect(rewrite(earlyTask)).toBe(rewrite(lateTask));
    expect(earlyTask).toContain("regexp: '^(\\s+)NOVU_BRIDGE_CORE_SMS_DEFAULT_TENANT: pg$'");
    expect(earlyTask).toContain("replace: '\\1NOVU_BRIDGE_CORE_SMS_DEFAULT_TENANT: {{ state_root }}'");
    expect(earlyTask).toContain("when: state_root != 'pg'");
    expect(earlyTask).not.toMatch(/\n {6}tags:/); // not skippable on a tagged run that starts the bridge
    // and the running container is still checked against state_root at the end
    expect(task('novu-bootstrap — fail: novu-bridge does not run with state_root')).toContain(
      "(bridge_core_tenant.stdout | default('') | trim) != state_root");
  });

  // 4079418208: the pg → state_root rewrite of NOVU_BRIDGE_CORE_SMS_DEFAULT_TENANT only
  // reached the container through a recreate gated on a non-empty Novu key.
  test('novu-bridge is recreated whenever the OTP default-tenant rewrite changed', () => {
    expect(task('post-bootstrap — set NOVU_BRIDGE_CORE_SMS_DEFAULT_TENANT')).toContain('register: core_sms_tenant_rewrite');
    const recreate = task('novu-bootstrap — recreate novu-bridge so it picks up NOVU_API_KEY');
    expect(recreate).toContain('--force-recreate novu-bridge');
    expect(recreate).toContain("or ((core_sms_tenant_rewrite | default({})) is changed)");
  });

  // 4079418212: the admin password was spliced into the shell command, and a failed task
  // prints `cmd`.
  test('no task passes DIGIT_PASSWORD on its command line', () => {
    for (const name of [
      'master-repair — compare',
      'notif-seed — access-control rows (phase 1 of 2)',
      'notif-seed — schemas, channel rows, fresh-tenant defaults (phase 2 of 2)',
      'notif-seed — data phase again with the role-actions loaded',
    ]) {
      const t = task(name);
      expect(t).toMatch(/\n {6}environment:\n/);
      expect(t).toContain(`DIGIT_PASSWORD: "{{ notif_seed_pass | default('eGov@123') }}"`);
      expect(t).not.toMatch(/DIGIT_PASSWORD=/);
    }
    expect(playbook).not.toMatch(/DIGIT_PASSWORD=\{\{/);
  });

  // 4079418103: a tenant with no MDMS notification rows was always "fresh", so an upgrade
  // wrote the shipped defaults over every tenant that ran 2.12's hard-coded path.
  // 4118608347 / #1943: the decision (and the count) covered state_root only, while
  // novu-bridge resolves each complaint's configuration at the complaint's own root.
  test('the seed runs per state root with complaints, each with its own complaint count', () => {
    const roots = task('notif-seed — list the state roots complaints are filed under');
    // the same derivation the bridge applies, from the database, grouped per root
    expect(roots).toContain("select split_part(tenantid, '.', 1), count(*) from eg_pgr_service_v2");
    expect(roots).toContain('group by 1');
    expect(roots).toContain('failed_when: false');
    expect(roots).not.toMatch(/\{\{[^}]*state_root/); // no tenant spliced into the SQL
    const pick = task('notif-seed — the state roots to seed');
    expect(pick).toContain('[notif_seed_tenant | trim] + (notif_complaint_counts.keys()');
    expect(pick).toContain("select('match', '^[A-Za-z][A-Za-z0-9_-]*$')");
    expect(pick).toContain("notifications_seed_exclude | default('(?i)^(PW_|pwt)')");
    for (const name of [
      'notif-seed — access-control rows (phase 1 of 2)',
      'notif-seed — schemas, channel rows, fresh-tenant defaults (phase 2 of 2)',
      'notif-seed — data phase again with the role-actions loaded',
    ]) {
      const t = task(name);
      expect(t).toMatch(/\n {6}loop: "\{\{ /);
      expect(t).toContain('NOTIF_TENANT: "{{ item }}"');
      expect(t).toContain('DIGIT_LOGIN_TENANT: "{{ item }}"');
      expect(t).toContain('failed_when: false');
    }
    expect(task('notif-seed — schemas, channel rows, fresh-tenant defaults (phase 2 of 2)')).toContain(
      'loop: "{{ notif_acl_ok_roots | default([]) }}"');
    for (const name of [
      'notif-seed — schemas, channel rows, fresh-tenant defaults (phase 2 of 2)',
      'notif-seed — data phase again with the role-actions loaded',
    ]) {
      const t = task(name);
      // THIS root's count; an unreadable count must reach the seeder as EMPTY (unknown), never as 0
      expect(t).toContain(`NOTIF_TENANT_COMPLAINTS: "{{ (notif_complaint_counts[item] | default('0')) if (notif_complaint_counts_known | bool) else '' }}"`);
      expect(t).toContain(`NOTIF_ADOPT_DEFAULTS: "{{ '1' if item in notif_adopt_roots else '' }}"`);
    }
    expect(task('notif-seed — complaint counts per state root')).toContain(
      "if (notif_complaint_roots.rc | default(1)) == 0 else {}");
    expect(playbook.indexOf('notif-seed — list the state roots')).toBeLessThan(
      playbook.indexOf('notif-seed — schemas, channel rows, fresh-tenant defaults'));

    // every root reported, and each ACTION names ITS root
    expect(task('notif-seed — result per state root')).toContain('loop: "{{ notif_seed_roots }}"');
    const none = task('notif-seed — ACTION: this tenant has no notification configuration');
    expect(none).toContain("' state=none '");
    expect(none).toContain('--tenant {{ item }} --adopt-defaults');
    expect(none).toContain('loop: "{{ notif_seed_roots }}"');
    const legacy = task("notif-seed — ACTION: this tenant's notification configuration is not migrated");
    expect(legacy).toContain("' state=legacy '");
    expect(legacy).toContain('--tenant {{ item }}');

    // one bad root does not hide the others: the only fail is after the report, and it is about
    // state_root alone. Vinoth 4141822048: a `ke` box restored from full-dump.sql carries the stock
    // `pg.*` demo complaints, so a 403 / unreadable schema at `pg` must warn, not abort the deploy.
    const fail = task('notif-seed — fail: state_root could not be seeded');
    expect(playbook.indexOf('notif-seed — fail: state_root could not be seeded')).toBeGreaterThan(
      playbook.indexOf('notif-seed — result per state root'));
    expect(fail).toContain("{{ [notif_seed_tenant | trim] | reject('in', notif_seed_done_roots) | list }}");
    expect(fail).not.toContain('notif_seed_roots');
    const block = playbook.slice(playbook.indexOf('notif-seed — list the state roots'),
      playbook.indexOf('notif-seed — fail: state_root could not be seeded'));
    expect(block).not.toContain('ansible.builtin.fail:');
    const other = task('notif-seed — WARNING: a complaint root other than state_root could not be seeded');
    expect(other).toContain('ansible.builtin.debug:');
    expect(other).toContain('loop: "{{ notif_seed_roots }}"');
    expect(other).toContain('- item != (notif_seed_tenant | trim)');
    expect(other).toContain('- item not in notif_seed_done_roots');
    expect(other).toContain('- item not in notif_seed_login_refused_roots');
    expect(other).toContain('--tags notifications');
    expect(other).toContain('notifications_seed_exclude');
    expect(playbook.indexOf('notif-seed — roots that did not finish')).toBeLessThan(
      playbook.indexOf('notif-seed — WARNING: a complaint root other than state_root'));

    // Vinoth 4141822040: a root's admin may plan/apply (and preview) its own root, but only an
    // owning-state admin may create a provider — every ACTION line says so for ITS root.
    // Vinoth 4154544385: one copy of the note, set before both ACTION loops.
    const notes = task('notif-seed — who may create a provider, per state root');
    expect(notes).toContain('ansible.builtin.set_fact:');
    expect(notes).toContain('notif_provider_owner_notes: >-');
    expect(notes).toContain("{%- set owners = ([notif_seed_tenant | trim] + ((novu_bridge_provider_admin_tenants | default('')) | string).split(','))");
    expect(notes).toContain('{%- for root in notif_seed_roots -%}');
    expect(notes).toContain('403 NB_TENANT_NOT_ALLOWED');
    expect(notes).toContain("--provider SMS=<identifier>");
    expect(notes).toContain('seed_notifications | default(enable_novu | default(false))');
    expect(notes).toContain("tags: ['notifications', 'notification-seed']");
    const notesAt = playbook.indexOf('- name: "notif-seed — who may create a provider, per state root"');
    for (const [name, t] of [
      ['notif-seed — ACTION: this tenant has no notification configuration', none],
      ["notif-seed — ACTION: this tenant's notification configuration is not migrated", legacy],
    ]) {
      expect(t).toContain('{{ notif_provider_owner_notes[item] }}');
      expect(t).not.toMatch(/\n {6}vars:/);
      expect(t).not.toContain('novu_bridge_provider_admin_tenants | default');
      expect(playbook.indexOf(`- name: "${name}`)).toBeGreaterThan(notesAt);
    }
    expect(playbook.match(/notif_provider_owner_notes: >-/g)).toHaveLength(1);
    expect(playbook.match(/split\('\,'\)\)\n\s+\| map\('trim'\) \| reject\('equalto', ''\) \| unique \| list/g)).toHaveLength(1);
    expect(playbook).not.toMatch(/notif_provider_owners?:|notif_provider_owner_note\b/);
    expect(task('notif-seed — WARNING: could not log in at a complaint root')).toContain('item != (notif_seed_tenant | trim)');
  });

  test('notifications_adopt_defaults is validated and may name roots', () => {
    expect(task('notif-seed — notifications_adopt_defaults is true, false, or a list of state roots')).toContain(
      'ansible.builtin.assert:');
    const adopt = task('notif-seed — the roots notifications_adopt_defaults covers');
    expect(adopt).toContain("notif_seed_roots if (notifications_adopt_defaults | default(false) | bool) else []");
    expect(adopt).toContain("notifications_adopt_defaults.split(',')");
    const example = read('local-setup/ansible/inventory/host_vars/_example.yml');
    expect(example).toMatch(/^# notifications_adopt_defaults: false$/m);
    expect(example).toMatch(/^# notifications_adopt_defaults: \[pg\]/m);
    expect(example).toMatch(/^# notifications_seed_exclude: /m);
  });
});

// Kanav re-review 4118608379: ~50 `#L<n>` anchors in the e2e README pointed past the end of
// files or at unrelated code once the code moved. The links now name `Class.member` instead;
// this keeps every name true.
describe('e2e notifications README code links', () => {
  const readme = read('local-setup/tests/e2e/notifications/README.md');
  const links = [...readme.matchAll(/\[`([^`]+)`\]\((\/[^)\s]+)\)/g)].map((m) => ({ label: m[1], target: m[2] }));
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  test('carries no line anchors', () => {
    expect(readme).not.toMatch(/#L\d/);
    expect(links.length).toBeGreaterThan(80);
  });

  test('every linked file exists and every named member is declared in it', () => {
    const problems: string[] = [];
    for (const { label, target } of links) {
      const rel = target.replace(/^\//, '').replace(/#.*$/, '');
      if (!fs.existsSync(path.join(REPO_ROOT, rel))) {
        problems.push(`${label} → ${rel}: file missing`);
        continue;
      }
      const src = read(rel);
      if (rel.endsWith('.json') && /^[A-Z][\w-]*\.[A-Z]\w+$/.test(label)) {
        if (!src.includes(`"code": "${label}"`)) problems.push(`${label}: no schema with that code in ${rel}`);
        continue;
      }
      if (!rel.endsWith('.java') || !label.includes('.')) continue;
      const parts = label.split('.');
      if (parts[0] !== path.basename(rel, '.java')) problems.push(`${label}: class is not ${path.basename(rel)}`);
      const member = esc(parts[parts.length - 1]);
      const declared = [
        new RegExp(`^\\s*(?:@\\w+(?:\\([^)]*\\))?\\s+)*(?:(?:public|private|protected|static|final|synchronized|abstract|default)\\s+)*[\\w<>\\[\\],.? ]+\\s+${member}\\s*\\(`, 'm'),
        new RegExp(`[\\w>\\]]\\s+${member}\\s*(?:=|;)`),
        new RegExp(`\\b(?:class|record|interface|enum)\\s+${member}\\b`),
      ].some((re) => re.test(src));
      if (!declared) problems.push(`${label}: ${parts[parts.length - 1]} is not declared in ${rel}`);
    }
    expect(problems).toEqual([]);
  });
});

describe('standalone Identity BFF and Keycloak deployment contract', () => {
  const service = (compose: string, name: string) => {
    const start = compose.indexOf(`\n  ${name}:\n`);
    expect(start).toBeGreaterThan(-1);
    const rest = compose.slice(start + 1);
    const end = rest.slice(1).search(/\n  [a-z0-9-]+:\n/);
    return end < 0 ? rest : rest.slice(0, end + 1);
  };

  test('top-level Keycloak paths are used by build, CI, and Ansible', () => {
    const build = read('build/build-config.yml');
    expect(build).toContain('work-dir: "keycloak"');
    expect(build).toContain('dockerfile: "keycloak/Dockerfile"');
    const playbook = read('local-setup/ansible/playbook-deploy.yml');
    expect(playbook).toContain('src: ../../keycloak/configure-keycloak.sh');
    expect(playbook).toContain('src: ../../keycloak/realm.json');
    expect(playbook).toContain('KEYCLOAK_REALM_CONFIG: "{{ digit_dir }}/identity-keycloak-realm.json"');
    expect(read('.github/workflows/keycloak-ci.yml')).toContain('- "keycloak/**"');
    expect(read('.github/workflows/identity-bff-ci.yml')).not.toContain('backend/identity-bff/keycloak');
  });

  test('new settings are optional and onboarding runs only in PGR', () => {
    const env = read('local-setup/ansible/templates/digit.env.j2');
    expect(env).toContain("IDENTITY_STAFF_CREDENTIAL_MODE={{ identity_staff_credential_mode | default('rotate') }}");
    expect(env).toContain("IDENTITY_SURFACES_JSON={{ identity_surfaces_json | default('') }}");
    expect(env).toContain("{% set fixed_otp = identity_dev_fixed_otp | default(false) | bool %}");
    expect(env).not.toContain('identity_dev_fixed_otp | default(not');
    expect(env).toContain('CITIZEN_LOGIN_PASSWORD_OTP_FIXED_ENABLED={{ fixed_otp | lower }}');
    expect(env).toContain("IDENTITY_CITIZEN_OTP_SENDER={{ identity_citizen_otp_sender | default('log' if fixed_otp else '') }}");
    expect(env).toContain('PGR_ONBOARDING_RUNNER_ENABLED={{ pgr_onboarding_runner_effective | bool | lower }}');
    const bff = service(read('local-setup/docker-compose.egov-digit.yaml'), 'identity-bff');
    for (const setting of ['IDENTITY_SURFACES_JSON', 'IDENTITY_STAFF_CREDENTIAL_MODE',
      'IDENTITY_CREDENTIAL_KEYS', 'IDENTITY_CREDENTIAL_KEY_CURRENT', 'IDENTITY_CITIZEN_OTP_SENDER',
      'IDENTITY_POLLER_MAX_LAG_SECONDS']) {
      expect(bff).toContain(`${setting}:`);
    }
    expect(bff).not.toMatch(/^ +(?:PGR_)?ONBOARDING_WORKER_\w*:/m);
    for (const removed of ['DIGIT_PROVISIONER_USERNAME', 'DIGIT_MDMS_CREATE_URL']) {
      expect(bff).not.toContain(`${removed}:`);
    }
    expect(read('local-setup/ansible/playbook-deploy.yml')).toContain("rotate mode requires neither");
  });

  test('fixed citizen OTP is off by default in every compose path', () => {
    const variable = 'CITIZEN_LOGIN_PASSWORD_OTP_FIXED_ENABLED: ${CITIZEN_LOGIN_PASSWORD_OTP_FIXED_ENABLED:-false}';
    const files = ['local-setup/docker-compose.yml', 'local-setup/docker-compose.registry.yml',
      'local-setup/docker-compose.egov-digit.yaml', 'backend/identity-bff/deploy/digit-compose/docker-compose.identity.yml'];
    for (const file of files) expect(read(file)).not.toMatch(/OTP_FIXED_ENABLED:-true/);
    for (const file of ['local-setup/docker-compose.yml', 'local-setup/docker-compose.registry.yml']) {
      expect(service(read(file), 'egov-user')).toContain(variable);
    }
    const full = read('local-setup/docker-compose.egov-digit.yaml');
    expect(service(full, 'egov-user')).toContain(variable);
    expect(service(full, 'identity-bff')).toContain(variable);
    expect(service(full, 'identity-bff')).toContain('IDENTITY_CITIZEN_OTP_SENDER: ${IDENTITY_CITIZEN_OTP_SENDER:-}');
    expect(read('backend/identity-bff/deploy/digit-compose/docker-compose.identity.yml')).toContain(variable);
  });

  test('the deploy warns, without failing, when citizen phone sign-in has no OTP channel', () => {
    const playbook = read('local-setup/ansible/playbook-deploy.yml');
    const start = playbook.indexOf('- name: "preflight — warn when citizen phone sign-in has no OTP channel"');
    expect(start).toBeGreaterThan(-1);
    const task = playbook.slice(start, playbook.indexOf('\n\n', start));
    expect(task).toContain('ansible.builtin.debug:');
    expect(task).not.toMatch(/assert:|fail:/);
    for (const guard of ['enable_keycloak | default(false) | bool',
      'not (enable_otp_services | default(false) | bool)',
      'not (identity_dev_fixed_otp | default(false) | bool)',
      "not (identity_citizen_otp_sender | default('', true) | length > 0)"]) {
      expect(task).toContain(guard);
    }
    expect(task).toContain('citizen phone sign-in is unavailable');
  });

  test('no host_vars example claims the citizen OTP is always 123456', () => {
    for (const file of ['_example.yml', 'quickstart.yml.example']) {
      expect(read(`local-setup/ansible/inventory/host_vars/${file}`)).not.toMatch(/always 123456/);
    }
    expect(read('local-setup/ansible/inventory/host_vars/_example.yml')).toContain('# identity_dev_fixed_otp: false');
  });
});

// 8c gate report 4, Part A: the BFF container must receive every setting the
// deploy resolves for it, and pgr-services must send the BFF's onboarding bearer.
describe('identity-bff compose wiring', () => {
  const compose = read('local-setup/docker-compose.egov-digit.yaml');
  const service = (name: string) => {
    const start = compose.indexOf(`\n  ${name}:\n`);
    expect(start).toBeGreaterThan(-1);
    const next = compose.slice(start + 1).search(/\n  [a-z0-9-]+:\n/);
    return compose.slice(start, next < 0 ? undefined : start + 1 + next);
  };

  test('passes the surface secrets, OTP secret, onboarding token and OTP mint URL', () => {
    const bff = service('identity-bff');
    for (const line of [
      'KEYCLOAK_EMPLOYEE_CLIENT_SECRET: ${KEYCLOAK_EMPLOYEE_CLIENT_SECRET:-}',
      'KEYCLOAK_CITIZEN_CLIENT_SECRET: ${KEYCLOAK_CITIZEN_CLIENT_SECRET:-}',
      'IDENTITY_CITIZEN_OTP_SECRET: ${IDENTITY_CITIZEN_OTP_SECRET:-}',
      'IDENTITY_ONBOARDING_TOKEN: ${IDENTITY_ONBOARDING_TOKEN:-}',
      'DIGIT_OTP_CREATE_URL: ${DIGIT_OTP_CREATE_URL:-http://egov-otp:8089/otp/v1/_create}',
    ]) {
      expect(bff).toContain(line);
    }
    // the code no longer reads these
    expect(bff).not.toContain('IDENTITY_ORGANIZATION_ADMIN_ROLES');
    expect(bff).not.toContain('IDENTITY_ORGANIZATION_MEMBER_GROUP');
  });

  test('pgr-services sends the same onboarding bearer the BFF requires', () => {
    expect(service('pgr-services')).toContain(
      'PGR_ONBOARDING_IDENTITY_BFF_TOKEN: ${IDENTITY_ONBOARDING_TOKEN:-}'
    );
  });

  test('Ansible can override the OTP mint URL without losing the compose default', () => {
    const env = read('local-setup/ansible/templates/digit.env.j2');
    expect(env).toContain("DIGIT_OTP_CREATE_URL={{ identity_digit_otp_create_url | default('') }}");
  });
});

describe('D26 legacy identity paths are retired', () => {
  const playbook = read('local-setup/ansible/playbook-deploy.yml');
  const nginx = read('local-setup/ansible/templates/nginx-site.conf.j2');
  const kong = read('local-setup/kong/kong.yml');

  test('tenantless digit-ui paths redirect only through an explicit default slug', () => {
    expect(nginx).toContain('return 302 /{{ digit_ui_default_tenant_slug }}/digit-ui/;');
    expect(nginx).toContain('return 302 /{{ digit_ui_default_tenant_slug }}$request_uri;');
    expect(nginx).toContain('return 302 /{{ digit_ui_default_tenant_slug }}/digit-ui/citizen/login;');
    // static/container/HMR app locations plus the public-dashboard alias.
    expect(nginx.match(/\{\{ tenantless_digit_ui_guard\('    '\) \}\}/g)).toHaveLength(4);
    expect(playbook).toContain('digit_ui_default_tenant_slug is match');
  });

  // Blocker (Dhruv, #2271 review 2): esbuild's PUBLIC_PATH is the absolute
  // "/digit-ui/", so a tenant page loads its JS/CSS from the tenantless prefix.
  // The tenantless guard must let every such asset through while still
  // refusing tenantless HTML/app routes.
  describe('tenantless guard exempts the bundle assets tenant pages load', () => {
    const guardSource = nginx.match(/\{% set html_route = '([^']+)' %\}/);
    const guard = new RegExp(guardSource ? guardSource[1] : '^$');
    const helmAssets = read('devops/deploy-as-code/charts/urban/digit-ui/templates/static-assets-ingress.yaml');
    const helmPath = helmAssets.match(/- path: \/\{\{ \.Values\.ingress\.context \}\}(\S+)/);
    // ingress-nginx anchors the path with `^` and matches it case-insensitively.
    const helmAsset = new RegExp(`^/digit-ui${helmPath ? helmPath[1] : '$^'}`, 'i');
    const esbuild = read('digit-ui-esbuild/esbuild.build.js');
    const shells = ['index.html', 'public-dashboard.html'].map((f) => read(`digit-ui-esbuild/public/${f}`));
    const shellAssets = shells.flatMap((html) =>
      [...html.matchAll(/(?:src|href)="(\/digit-ui\/[^"]+)"/g)].map((m) => m[1]));
    const loadedAssets = [
      ...shellAssets,
      // generateHTML() injects these; analytics.js is fetched by index.html.
      '/digit-ui/index.js', '/digit-ui/index.css',
      '/digit-ui/public-dashboard.js', '/digit-ui/public-dashboard.css',
      '/digit-ui/analytics.js', '/digit-ui/analytics.js?v=2',
      '/digit-ui/brand/digit-footer.png', '/digit-ui/logo-AB12CD.svg', '/digit-ui/font-AB12CD.woff2',
    ];

    test('the bundle really is built against the absolute /digit-ui/ prefix', () => {
      expect(guardSource).not.toBeNull();
      expect(helmPath).not.toBeNull();
      expect(esbuild).toContain('const PUBLIC_PATH = "/digit-ui/";');
      expect(shellAssets).toEqual(expect.arrayContaining([
        '/digit-ui/globalConfigs.js', '/digit-ui/vendor/digit-ui-css.css',
      ]));
    });

    test.each(loadedAssets)('nginx and Helm serve %s on a tenant page', (asset) => {
      expect(guard.test(asset)).toBe(false);
      expect(helmAsset.test(asset.split('?')[0])).toBe(true);
    });

    test.each([
      '/digit-ui/', '/digit-ui/citizen/login', '/digit-ui/employee/user/login',
      '/digit-ui/index.html', '/digit-ui/public-dashboard', '/digit-ui/public-dashboard.html',
      '/digit-ui/citizen/login?from=/x.js', '/digit-ui/employee/report.jsp',
    ])('tenantless app route %s stays behind the guard', (route) => {
      expect(guard.test(route)).toBe(true);
      expect(helmAsset.test(route.split('?')[0])).toBe(false);
    });

    test('the tenant-scoped public dashboard is served in place, not redirected away', () => {
      const location = nginx.slice(
        nginx.indexOf('location = /digit-ui/public-dashboard {'),
        nginx.indexOf('location = /dashboard {'),
      );
      expect(location).toContain('rewrite ^ /digit-ui/public-dashboard.html last;');
      expect(location).not.toMatch(/^\s*return /m);
      expect(read('devops/deploy-as-code/charts/urban/digit-ui/templates/globalconfigs-configmap.yaml'))
        .toContain('rewrite ^ /{{ .Values.ingress.context }}/public-dashboard.html last;');
    });

    // Low (Dhruv, #2271 review 3): a URL with an asset extension that matched
    // no file (/digit-ui/citizen.js, login;.js) got index.html with a 200. Each
    // nginx that serves the bundle now answers those with a 404, using the
    // guard's extension list (verified in nginx:alpine for all four configs).
    test.each([
      'local-setup/ansible/templates/nginx-site.conf.j2',
      'local-setup/nginx/digit-ui.conf',
      'digit-ui-esbuild/docker/nginx.conf',
      'devops/deploy-as-code/charts/urban/digit-ui/templates/globalconfigs-configmap.yaml',
    ])('%s 404s a missing asset instead of serving the SPA shell', (file) => {
      const conf = read(file);
      const extensions = guardSource![1].match(/\[\.\]\(\?:([^)]+)\)/)![1];
      const nested = new RegExp(
        `try_files \\$uri \\$uri/ /[^;]+/index\\.html;[\\s\\S]*?\\n(\\s+)location ~ "\\[\\.\\]\\(\\?:${extensions.replace(/[|?]/g, '\\$&')}\\)\\$" \\{\\n\\s+try_files \\$uri =404;\\n\\1\\}`,
      );
      expect(conf).toMatch(nested);
    });

    test('Helm routes the assets whenever the legacy ingress is off', () => {
      expect(helmAssets).toContain('if and .Values.ingress.enabled (not .Values.ingress.legacyPathEnabled)');
      expect(helmAssets).toContain('nginx.ingress.kubernetes.io/use-regex');
    });
  });

  // High 2 (Dhruv, #2271 review 2): the post-deploy gate and the Helm blackbox
  // probe both GET a URL that D26 turned into a 404 when no default slug is set.
  test('deploy validation and the blackbox probe check URLs that exist without a default slug', () => {
    const gate = playbook.slice(
      playbook.indexOf('- name: "validate — public UI serves the tenant route and its bundle"'),
      playbook.indexOf('- name: "validate — configurator returns 200 (when enabled)"'),
    );
    expect(gate).toContain('{path: "/{{ digit_ui_default_tenant_slug | default(\'\', true) or \'deploy-check\' }}/digit-ui/", type: "text/html"}');
    expect(gate).toContain('{path: "/digit-ui/index.js", type: "javascript"}');
    expect(gate).toContain('is search(item.type)');
    expect(playbook).not.toContain('- name: "validate — public UI returns 200"');
    const probe = read('devops/deploy-as-code/charts/monitoring/monitoring-helmfile.yaml');
    expect(probe).not.toContain('- https://{{ .Values.global.domain }}/digit-ui/\n');
  });

  // Low (Dhruv, #2271 review 3): the blackbox probe fetched the 8.4 MB index.js
  // every 30 s under a 5 s timeout. It now fetches globalConfigs.js and, since
  // the pod answers a missing file with index.html and a 200, requires a
  // JavaScript Content-Type.
  test('the blackbox probe fetches the small globalConfigs.js and checks it is JavaScript', () => {
    const probe = read('devops/deploy-as-code/charts/monitoring/monitoring-helmfile.yaml');
    const job = probe.slice(probe.indexOf('- job_name: blackbox\n'), probe.indexOf('- job_name: blackbox_exporter'));
    expect(job).toContain('module: [http_2xx_javascript]');
    expect(job).toContain('- https://{{ .Values.global.domain }}/digit-ui/globalConfigs.js');
    expect(job).not.toMatch(/^\s+- https:\/\/\S+\/digit-ui\/index\.js/m);
    const blackbox = read('devops/deploy-as-code/charts/monitoring/values/blackbox-exporter.yaml');
    const module = blackbox.slice(blackbox.indexOf('    http_2xx_javascript:'), blackbox.indexOf('    http_post_2xx:'));
    expect(module).toMatch(/fail_if_header_not_matches:\n\s+- header: Content-Type\n\s+regexp: "javascript"/);
    // The chart serves it with that type.
    expect(read('devops/deploy-as-code/charts/urban/digit-ui/templates/globalconfigs-configmap.yaml'))
      .toMatch(/location = \/\{\{ \.Values\.ingress\.context \}\}\/globalConfigs\.js \{[^}]*default_type application\/javascript;/);
  });

  test('Helm publishes only tenant-scoped digit-ui routes by default', () => {
    expect(read('devops/deploy-as-code/charts/urban/digit-ui/values.yaml')).toContain('legacyPathEnabled: false');
    expect(read('devops/deploy-as-code/charts/urban/digit-ui/templates/ingress.yaml'))
      .toContain('if .Values.ingress.legacyPathEnabled');
    // ingress-nginx only accepts an absolute http(s) redirect target.
    expect(read('devops/deploy-as-code/charts/urban/digit-ui/templates/tenantless-redirect-ingress.yaml'))
      .toContain('temporal-redirect: {{ printf "%s://%s/%s$request_uri" $scheme $host .Values.ingress.defaultTenantSlug | quote }}');
    expect(read('devops/deploy-as-code/charts/core-services/configmaps/values.yaml'))
      .toContain('defaultTenantSlug: ""');
  });

  test('Kong denies legacy native endpoints but preserves oauth token', () => {
    const nativePaths = [
      '- /user/password/nologin/_update',
      '- /user/citizen/_create',
      '- /user-otp/v1/_send',
    ];
    const denyBlock = kong.slice(
      kong.indexOf('identity-legacy-user-deny-start'),
      kong.indexOf('identity-legacy-user-deny-end'),
    );
    for (const path of nativePaths) expect(denyBlock).toContain(path);
    expect(denyBlock).not.toContain('- /otp');
    expect(kong).toContain('# identity-legacy-otp-mock-start');
    expect(playbook).toContain('identity-legacy-otp-mock-start');
    expect(kong).toContain('["/user/oauth/token"]=true');
    expect(kong).toContain('isInternal is not accepted at the public gateway');
    expect(playbook).toContain('identity_legacy_user_endpoints');
    expect(playbook).toContain('default(not (enable_keycloak | default(false)))');

    // Mirror the two Ansible replacements for the Keycloak/default-false
    // configuration: the three native calls leave AUTH_OPTIONAL, the mock
    // service disappears, and oauth remains available for refresh/internal use.
    const keycloakConfig = kong
      .replace(/^.*-- identity-legacy-user-endpoint\n/gm, '')
      .replace(/^# identity-legacy-otp-mock-start\n[\s\S]*?^# identity-legacy-otp-mock-end\n/m, '');
    const authOptional = keycloakConfig.slice(0, keycloakConfig.indexOf('services:'));
    const legacyAuthPaths = [...nativePaths.map((path) => path.slice(2)), '/otp/v1/_validate'];
    for (const path of legacyAuthPaths) {
      expect(authOptional).not.toContain(`["${path}"]=true`);
    }
    expect(authOptional).toContain('["/user/oauth/token"]=true');
    expect(keycloakConfig).not.toContain('name: otp-validate-mock');
    expect(keycloakConfig).toContain('name: identity-legacy-user-endpoints-denied');
  });

  // High 3 (Dhruv, #2271 review 2): with Keycloak off there is no Identity
  // BFF, so no tenant route resolves and nobody can sign in.
  test('the deploy refuses enable_keycloak: false and every shipped example turns it on', () => {
    const preflight = playbook.slice(playbook.indexOf('- name: "preflight — identity requires enable_keycloak: true"'));
    expect(preflight).toMatch(/^- name: "preflight — identity requires enable_keycloak: true"\n\s+ansible\.builtin\.fail:/);
    expect(preflight.slice(0, 1500)).toContain("when: not (enable_keycloak | default(false) | bool)");
    const dir = 'local-setup/ansible/inventory/host_vars';
    const examples = fs.readdirSync(path.join(REPO_ROOT, dir))
      .filter((f) => f.endsWith('.example') || f === '_example.yml');
    expect(examples.length).toBeGreaterThanOrEqual(6);
    for (const example of examples) {
      const text = read(`${dir}/${example}`);
      expect([example, text.match(/^enable_keycloak: (\S+)/m)?.[1]]).toEqual([example, 'true']);
      expect([example, /^\s+keycloak: true\b/m.test(text)]).toEqual([example, true]);
      expect([example, /OTP login works without|inert while enable_keycloak is false|DIGIT keeps working on OTP login/.test(text)])
        .toEqual([example, false]);
    }
    expect(read('local-setup/README.md')).not.toContain("DIGIT's own OTP login works without it");
  });

  // Low (Dhruv, #2271 review 2): the Helm Spring gateway must close the same
  // native identity endpoints Kong drops from AUTH_OPTIONAL.
  test('the Spring gateway whitelists do not open the retired identity endpoints', () => {
    const retired = ['/user-otp/v1/_send', '/otp/v1/_validate', '/user/citizen/_create', '/user/password/nologin/_update'];
    for (const file of [
      'devops/deploy-as-code/charts/environments/env.yaml',
      'devops/deploy-as-code/charts/core-services/gateway/values.yaml',
    ]) {
      const whitelists = read(file).split('\n')
        .filter((line) => /egov-(open|mixed-mode)-endpoints-whitelist:/.test(line))
        .flatMap((line) => line.split(':').slice(1).join(':').replace(/"/g, '').split(',').map((p) => p.trim()));
      expect(whitelists.length).toBeGreaterThan(10);
      for (const path of retired) expect([file, whitelists.includes(path)]).toEqual([file, false]);
    }
    for (const path of retired) expect(kong).toContain(`["${path}"]=true, -- identity-legacy-user-endpoint`);
    const parity = read('.github/scripts/check-gateway-whitelist-parity.py');
    expect(parity).toContain('LEGACY_IDENTITY_TAG = "-- identity-legacy-user-endpoint"');
  });

  // Low (Dhruv, #2271 review 2): host_vars keys that no longer do anything
  // must not be documented as if they did.
  test('the example host_vars do not document retired no-op keys', () => {
    const dir = 'local-setup/ansible/inventory/host_vars';
    for (const example of fs.readdirSync(path.join(REPO_ROOT, dir)).filter((f) => f.endsWith('.example') || f === '_example.yml')) {
      expect([example, /^login_tenant_allowlist:/m.test(read(`${dir}/${example}`))]).toEqual([example, false]);
    }
    // Every example, not just _example.yml (#2271 review 3: bomet and the
    // localhost examples still set auth_provider and keycloak_client_id).
    for (const example of fs.readdirSync(path.join(REPO_ROOT, dir)).filter((f) => f.endsWith('.example') || f === '_example.yml')) {
      const body = read(`${dir}/${example}`);
      for (const key of ['auth_provider', 'citizen_auth_provider', 'employee_auth_provider', 'keycloak_client_id']) {
        expect([example, key, new RegExp(`^\\s*#? ?${key}:`, 'm').test(body)]).toEqual([example, key, false]);
      }
    }
    const reference = read(`${dir}/_example.yml`);
    expect(reference).toContain('# Retired (D26): auth_provider, citizen_auth_provider, employee_auth_provider');
    // Nothing renders the allowlist into the UI config any more.
    expect(read('local-setup/ansible/templates/globalConfigs.js.j2')).not.toContain('login_tenant_allowlist');
  });

  // Low (Dhruv, #2271 review 3): ~38 Playwright navigations across the spec
  // and page files still opened tenantless /digit-ui/<route> URLs, which D26
  // turns into a 404 or a redirect to the deployment default. They go through
  // appBase() (/<E2E_TENANT_SLUG>/digit-ui) now. The one tenantless URL left
  // is the static globalConfigs.js that loginViaApi uses to set the origin.
  test('Playwright specs navigate only to tenant-scoped digit-ui routes', () => {
    const e2eDir = path.join(REPO_ROOT, 'local-setup/tests/e2e');
    const files = (fs.readdirSync(e2eDir, { recursive: true }) as string[])
      .filter((f) => f.endsWith('.ts') && !f.includes('node_modules'));
    const tenantless: string[] = [];
    let scoped = 0;
    for (const file of files) {
      const body = fs.readFileSync(path.join(e2eDir, file), 'utf8');
      for (const m of body.matchAll(/goto\(\s*([`'"])([^`'"]*)/g)) {
        if (m[2].includes('${appBase()}')) scoped += 1;
        if (/^(?:\$\{[A-Za-z_.]+\})?\/digit-ui\//.test(m[2]) && !m[2].endsWith('/digit-ui/globalConfigs.js')) {
          tenantless.push(`${file}: ${m[2]}`);
        }
      }
      expect([file, /^const \w+ = '\/digit-ui\//m.test(body)]).toEqual([file, false]);
    }
    expect(tenantless).toEqual([]);
    expect(scoped).toBeGreaterThanOrEqual(38);
  });

  test('digit-ui-v2 cannot be deployed after its citizen identity removal', () => {
    expect(playbook).toContain('enable_digit_ui_v2 is no longer supported');
    expect(playbook).toContain('D26 retired its fixed-OTP');
  });

  test('legacy UI implementations are absent and BFF-flow specs remain', () => {
    for (const removed of [
      'digit-ui-esbuild/packages/modules/core/src/pages/citizen/Login/index.js',
      'digit-ui-esbuild/packages/modules/core/src/pages/citizen/Login/SelectName.js',
      'digit-ui-esbuild/packages/modules/core/src/pages/employee/Login/login.js',
      'digit-ui-esbuild/packages/modules/core/src/pages/employee/Otp/index.js',
      'digit-ui-esbuild/packages/modules/core/src/pages/employee/ForgotPassword/index.js',
      'digit-ui-esbuild/packages/modules/core/src/pages/employee/ChangePassword/index.js',
      'digit-ui-v2/src/pages/CitizenLoginPage.tsx',
      'digit-ui-v2/src/pages/CitizenProfilePage.tsx',
      // Only navigated to the removed /user/login and /user/sign-up pages.
      'digit-ui-esbuild/packages/modules/core/src/components/LoginSignupSelector.js',
    ]) expect(fs.existsSync(path.join(REPO_ROOT, removed))).toBe(false);
    // No navigation to the removed tenantless wrapper's pages.
    expect(read('digit-ui-esbuild/packages/libraries/src/services/molecules/Store/service.js'))
      .not.toMatch(/location\.href = .*\/user\/invalid-url/);
    expect(read('digit-ui-esbuild/packages/modules/core/src/Module.js')).not.toContain('LoginSignupSelector');
    expect(read('tests/integration-tests/tests/utils/citizen-login.ts'))
      .toContain("/identity/v1/citizen/otp/_send");
    expect(read('tests/integration-tests/tests/employee/login.spec.ts'))
      .toContain("staffContext(page");
    expect(read('tests/integration-tests/tests/keycloak/new-citizen-provisioning.spec.ts'))
      .toContain("selectContext(page.request, BASE_URL, 'citizen'");
  });
});
