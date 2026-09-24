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

describe('docker-compose.egov-digit.yaml', () => {
  const compose = read('local-setup/docker-compose.egov-digit.yaml');

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

  test('the SMSCountry settings are rendered AND handed to the container', () => {
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

    // nothing routes SMSCountry through Novu — it is a direct client
    expect(composeEnv).not.toContain('NOVU_BRIDGE_SMS_INTEGRATION_IDENTIFIER');
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
      'NOVU_BRIDGE_SMSCOUNTRY_ALLOWED_HOSTS',
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
    expect(playbook).toContain("APPLY={{ '1' if (repair_tenant_masters | default(false) | bool) else '0' }}");
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
