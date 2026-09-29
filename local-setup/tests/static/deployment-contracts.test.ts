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
      'pgr_onboarding_worker_token',
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
  // its `digit-ui` client are gone, so `auth_provider: keycloak` is a 404 at
  // login until the frontend cutover onto /identity/v1 lands.
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

  test.each(images)('%#: %s defaults to the shared NOTIFICATION_STACK_TAG', (file, override, image) => {
    expect(composeDefault(file, override, image)).not.toBeNull();
    expect(env).toMatch(new RegExp(`^${override}=\\{\\{ `, 'm'));
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
  // the box with no OTP sender at all. So: early only when a recreated bridge is running,
  // otherwise after the main up once novu-bridge is healthy.
  test('the retired OTP senders go early only when a recreated bridge is running', () => {
    const bridgeFirst = playbook.indexOf('- name: "notification stack — recreate novu-bridge before pgr-services');
    const early = playbook.indexOf('- name: "notification stack — remove the retired OTP senders now');
    const mainStart = playbook.indexOf('- name: Start DIGIT stack (Linux/Debian)');
    const late = playbook.indexOf('- name: "notification stack — remove the retired OTP senders once novu-bridge is healthy');
    const pull = playbook.indexOf('- name: Pull all images from VPC registry');
    expect(pull).toBeGreaterThan(-1);
    expect(bridgeFirst).toBeGreaterThan(pull);
    expect(early).toBeGreaterThan(bridgeFirst);
    expect(mainStart).toBeGreaterThan(early);
    expect(late).toBeGreaterThan(mainStart);

    expect(task('notification stack — recreate novu-bridge before pgr-services')).toContain('echo "BRIDGE-RUNNING');
    const earlyTask = task('notification stack — remove the retired OTP senders now');
    expect(earlyTask).toContain('enable_novu | default(false)');
    expect(earlyTask).toContain('- bridge_first is changed');
    expect(earlyTask).toContain(`- "'BRIDGE-RUNNING' in (bridge_first.stdout | default(''))"`);
    expect(earlyTask).toContain('"$svc|{{ digit_dir }}"');
    expect(earlyTask).toContain('register: retired_notification_containers\n');

    const lateTask = task('notification stack — remove the retired OTP senders once novu-bridge is healthy');
    expect(lateTask).toContain('- retired_notification_containers is skipped');
    expect(lateTask).toContain('enable_novu | default(false)');
    // removal waits for the bridge's healthcheck, and a bridge that never gets healthy keeps them
    expect(lateTask).toMatch(/\[ "\$status" != "healthy" \]; then\n\s+echo "KEPT:/);
    expect(lateTask.indexOf('"$status" != "healthy"')).toBeLessThan(lateTask.indexOf('docker rm -f'));
    expect(lateTask).toContain('"$svc|{{ digit_dir }}"');
    expect(task('notification stack — WARNING: the retired OTP senders were kept')).toContain(
      "'KEPT:' in (retired_notification_containers_late.stdout | default(''))");
  });

  test('enable-notifications.sh removes the retired OTP senders only once a bridge can take over', () => {
    const sh = read('local-setup/scripts/enable-notifications.sh');
    const body = (fn: string) => {
      const start = sh.indexOf(`\n${fn}() {`);
      expect(start).toBeGreaterThan(-1);
      return sh.slice(start, sh.indexOf('\n}\n', start));
    };
    const step1 = body('do_step1');
    expect(step1.indexOf('compose up -d novu-bridge-migration novu-bridge')).toBeLessThan(
      step1.indexOf('_remove_retired_notification_containers'));
    expect(step1).toContain('_svc_running novu-bridge');
    const step2 = body('do_step2');
    expect(step2).not.toContain('_remove_retired_notification_containers');
    expect(step2.indexOf('compose up -d novu-mongo')).toBeLessThan(step2.indexOf('_remove_retired_after_bridge_healthy'));
    const wait = body('_remove_retired_after_bridge_healthy');
    expect(wait.indexOf('[[ "$status" != healthy ]]')).toBeLessThan(wait.indexOf('_remove_retired_notification_containers'));
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

    // one bad root does not hide the others: the only fail is after the report, and a refused
    // login at a root other than state_root is a warning
    const fail = task('notif-seed — fail: a state root could not be seeded');
    expect(playbook.indexOf('notif-seed — fail: a state root could not be seeded')).toBeGreaterThan(
      playbook.indexOf('notif-seed — result per state root'));
    expect(fail).toContain("reject('in', notif_seed_login_refused_roots | reject('equalto', notif_seed_tenant | trim) | list)");
    const block = playbook.slice(playbook.indexOf('notif-seed — list the state roots'),
      playbook.indexOf('notif-seed — fail: a state root could not be seeded'));
    expect(block).not.toContain('ansible.builtin.fail:');
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
