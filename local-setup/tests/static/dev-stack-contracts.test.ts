/**
 * Dev-stack contracts — Option A (`docker compose up`) and Option B (Tilt).
 *
 * Every block encodes a fault found validating those paths end-to-end for
 * #1744. Each one left the stack "healthy" while a developer-facing flow was
 * broken, which is why none of them was caught before. Pure file assertions:
 * no running stack needed.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const ROOT = path.resolve(__dirname, '..', '..'); // local-setup/
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
// Starlark source without comment lines, so commented-out examples don't count.
const code = (rel: string) => read(rel).split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

const COMPOSE = read('docker-compose.yml');
const TILT_OVERRIDE = read('docker-compose.tilt.yml');
const TILTFILES = ['Tiltfile', 'Tiltfile.db-dump'];

// Top-level service blocks of a compose file, keyed by name.
const services = (compose: string) => {
  const headers = [...compose.matchAll(/^  ([a-z0-9][a-z0-9_-]*):\s*$/gm)];
  return new Map(
    headers.map((h, i) => [h[1], compose.slice(h.index, headers[i + 1]?.index ?? compose.length)]),
  );
};
const COMPOSE_SERVICES = services(COMPOSE.slice(0, COMPOSE.search(/^volumes:|^networks:/m)));
const service = (name: string) => {
  const body = COMPOSE_SERVICES.get(name);
  if (!body) throw new Error(`docker-compose.yml has no service ${name}`);
  return body;
};
const image = (name: string) => service(name).match(/^\s+image:\s*(\S+)/m)![1];

describe('Tiltfiles only reference services that exist', () => {
  /**
   * A dc_resource() naming a service the compose file no longer has aborts
   * the whole Tiltfile at load time — every resource down, not just one.
   */
  for (const tiltfile of TILTFILES) {
    test(`${tiltfile} dc_resource names are docker-compose.yml services`, () => {
      const names = [...code(tiltfile).matchAll(/dc_resource\('([^']+)'/g)].map((m) => m[1]);
      expect(names.length).toBeGreaterThan(0);
      expect(names.filter((n) => !COMPOSE_SERVICES.has(n))).toEqual([]);
    });

    test(`${tiltfile} buttons start real services`, () => {
      // Nuke DB ran `up -d postgres` — the service is postgres-db, so it failed.
      for (const m of code(tiltfile).matchAll(/docker compose up -d ([a-z0-9 -]+)'/g)) {
        expect(m[1].trim().split(/\s+/).filter((n) => !COMPOSE_SERVICES.has(n))).toEqual([]);
      }
    });
  }

  test('Tiltfile does not read files that are not in the repo', () => {
    // The removed "Re-seed MDMS" button read ./db/seed.sql, which does not exist.
    for (const m of read('Tiltfile').matchAll(/< \.\/(\S+)'/g)) {
      expect(fs.existsSync(path.join(ROOT, m[1]))).toBe(true);
    }
  });
});

describe('Tilt builds the UI and PGR that Compose runs', () => {
  test('dev UI is the esbuild app docker-compose.yml runs, not the legacy webpack app', () => {
    // The Tiltfile built frontend/micro-ui while compose ran egovio/digit-ui-esbuild,
    // so `tilt up` silently swapped in a different UI.
    const tiltfile = read('Tiltfile');
    expect(image('digit-ui')).toMatch(/digit-ui-esbuild/);
    expect(tiltfile).toMatch(/UI_PATH = CCRS_PATH \+ '\/digit-ui-esbuild'/);
    expect(tiltfile).not.toMatch(/micro-ui\/web|build:webpack/);
    expect(fs.existsSync(path.join(ROOT, '..', 'digit-ui-esbuild', 'esbuild.dev.js'))).toBe(true);
  });

  test('every image the Tiltfile builds is bound by the Tilt override, and nothing else is', () => {
    const built = [...read('Tiltfile').matchAll(/docker_build\(\s*'([^']+)'/g)].map((m) => m[1]);
    const overridden = [...TILT_OVERRIDE.matchAll(/^\s+image:\s*(\S+)/gm)].map((m) => m[1]);
    expect(overridden.sort()).toEqual(built.sort());
  });

  test('CI mode runs the compose pins as-is (no retagged copies to drift)', () => {
    // CI used to pull egovio/digit-ui:dev-ff0db90 while compose pinned digit-ui-esbuild.
    const tiltfile = read('Tiltfile');
    expect(tiltfile).not.toMatch(/docker pull egovio\//);
    expect(tiltfile).toMatch(/if CI_MODE:\s*\n\s*docker_compose\('\.\/docker-compose\.yml'\)/);
  });

  test('the PGR dev image honours JAVA_OPTS and restarts on a class sync', () => {
    const tiltfile = read('Tiltfile');
    expect(tiltfile).toMatch(/exec java \$JAVA_OPTS/);
    expect(tiltfile).toMatch(/restart_container\(\)/);
  });
});

describe('docker-compose.yml pulls on a machine with an empty image cache', () => {
  test('no image from the removed minio/* Docker Hub repos', () => {
    // minio/minio and minio/mc no longer exist on Docker Hub, so a fresh
    // `docker compose up` (and every CI runner) failed to pull.
    for (const file of ['docker-compose.yml', 'docker-compose.deploy.yaml', 'docker-compose.db-migrations.yml']) {
      expect(read(file)).not.toMatch(/^\s+image:\s*minio\//m);
    }
  });
});

describe('PGR works end-to-end on the dev stack', () => {
  test('pgr-services reaches access-control (not its own localhost default)', () => {
    // Unset, PGR calls localhost:8080 — itself — and every employee search fails.
    expect(service('pgr-services')).toMatch(/EGOV_ACCESSCONTROL_HOST:\s*http:\/\/egov-accesscontrol:8090/);
  });

  test('PGR schema is migrated before pgr-services starts, at the app image tag', () => {
    // The dump's PGR schema is from 2020; without the migrator the persister's
    // INSERT fails and every complaint is lost after PGR has answered 200.
    const migrator = image('pgr-services-migration');
    const app = image('pgr-services').match(/:-([^}]+)\}/)![1];
    expect(migrator.split(':')[1]).toBe(app.split(':')[1]);
    expect(service('pgr-services')).toMatch(
      /pgr-services-migration:\s*\n\s*condition: service_completed_successfully/,
    );
  });

  test('egov-accesscontrol declares no in-container healthcheck', () => {
    // Its image is distroless (no /bin/sh), so a CMD-SHELL check stays "starting" forever.
    expect(service('egov-accesscontrol')).not.toMatch(/^\s+healthcheck:/m);
  });
});

describe('full-dump.sql seed users can log in', () => {
  /**
   * The dump is loaded as-is by Compose, Tilt, Ansible fast-path and the k8s
   * db-seed chart, so a bad seed user breaks every one of them at once.
   */
  const dump = read('db/full-dump.sql').split('\n');
  const copyBlock = (table: string) => {
    const start = dump.findIndex((l) => l.startsWith(`COPY public.${table} (`));
    const cols = dump[start].slice(dump[start].indexOf('(') + 1, dump[start].indexOf(')')).split(', ');
    const rows: Record<string, string>[] = [];
    for (let i = start + 1; dump[i] !== '\\.'; i++) {
      const f = dump[i].split('\t');
      rows.push(Object.fromEntries(cols.map((c, j) => [c, f[j]])));
    }
    return rows;
  };
  const users = copyBlock('eg_user');
  const keyByTenant = new Map(copyBlock('eg_enc_symmetric_keys').map((k) => [k.tenant_id, k.key_id]));

  test('no seed password expires within a year', () => {
    // Nine seed accounts (ADMIN on pg.citya/pg.cityb, CI-ADMIN) expired on
    // 2026-08-11; egov-user then rejects them as "Invalid login credentials".
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() + 1);
    const expiring = users.filter((u) => new Date(u.pwdexpirydate.replace(' ', 'T') + 'Z') < cutoff);
    expect(expiring.map((u) => `${u.id}@${u.tenantid}`)).toEqual([]);
  });

  test("every seed user's tenant ships its own encryption key", () => {
    // pg.citest had no key: enc-service generated a random one on first use, so
    // the dump's CI-ADMIN (encrypted under another key) could never be found.
    const missing = [...new Set(users.map((u) => u.tenantid))].filter((t) => !keyByTenant.has(t));
    expect(missing).toEqual([]);
  });

  test("seed users' encrypted fields use their own tenant's key", () => {
    // egov-user looks a user up by the username encrypted under the login
    // tenant's key. pg.citya/pg.cityb users were encrypted under pg's key, so
    // the README's "City A / ADMIN" login returned "User not found".
    const wrong = users.flatMap((u) =>
      ['username', 'name', 'mobilenumber', 'emailid']
        .filter((c) => /^\d+\|/.test(u[c] ?? '') && u[c].split('|')[0] !== keyByTenant.get(u.tenantid))
        .map((c) => `${u.id}@${u.tenantid}.${c}`),
    );
    expect(wrong).toEqual([]);
  });
});
