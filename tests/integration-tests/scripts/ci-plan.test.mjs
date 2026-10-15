import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, plan, summary } from './ci-plan.mjs';

const kind = p => classify(p).kind;
const changed = paths => plan(paths).changed;

test('docs, unit tests and other CI do not run the suite', () => {
  const p = plan([
    'docs/releases/2.12/notes.md',
    'backend/pgr-services/README.md',
    'backend/pgr-services/src/test/java/org/egov/pgr/FooTest.java',
    'configurator/src/lib/session.test.ts',
    'digit-mcp/src/__tests__/x.ts',
    '.github/workflows/build.yml',
    'devops/deploy-as-code/charts/monitoring/values/ingress.json',
    'tests/integration-tests/dashboard-react-admin/src/App.tsx',
    'tests/integration-tests/scripts/build-catalog.ts',
  ]);
  assert.equal(plan([]).run, false);
  assert.equal(p.run, false);
  assert.deepEqual(p.changed, []);
  assert.match(p.reason, /all 9 changed file/);
});

test('an unknown path runs the suite: a wrong skip hides a bug', () => {
  assert.equal(kind('something/new/file.sql'), 'runtime');
  assert.equal(kind('local-setup/db/full-dump.sql'), 'runtime');
  assert.equal(kind('local-setup/ansible/playbook-deploy.yml'), 'runtime');
  assert.equal(kind('digit-mcp/src/tools/mdms-tenant.ts'), 'runtime');
  assert.equal(plan(['README.md', 'local-setup/kong/kong.yml']).run, true);
});

test('the suite itself and this workflow run it', () => {
  assert.equal(kind('tests/integration-tests/tests/citizen/file-complaint.spec.ts'), 'runtime');
  assert.equal(kind('tests/integration-tests/tests/utils/env.ts'), 'runtime');
  assert.equal(kind('tests/integration-tests/playwright.config.ts'), 'runtime');
  assert.equal(kind('tests/integration-tests/playwright.ci.config.ts'), 'runtime');
  assert.equal(kind('tests/integration-tests/deploy/expectations/pg.json'), 'runtime');
  assert.equal(kind('tests/integration-tests/deploy/bomet.env'), 'ignored');
  assert.equal(kind('.github/workflows/integration-tests.yml'), 'runtime');
  assert.equal(kind('tests/integration-tests/scripts/ci-plan.mjs'), 'runtime');
  assert.equal(kind('tests/integration-tests/scripts/ci-plan.test.mjs'), 'ignored');
  assert.equal(kind('tests/integration-tests/scripts/ci-identities.sh'), 'runtime');
  assert.equal(kind('local-setup/docker-compose.ci.yml'), 'runtime');
  assert.equal(kind('local-setup/ansible/inventory/host_vars/ci.yml.example'), 'runtime');
  assert.equal(kind('local-setup/ansible/inventory/host_vars/bomet.yml.example'), 'ignored');
});

test('a docs/ folder inside src/ is code', () => {
  assert.equal(kind('configurator/src/onboarding/docs/DocsRail.tsx'), 'build');
  assert.equal(kind('digit-mcp/docs/tools.md'), 'ignored');
  assert.equal(kind('backend/identity-bff/docs/contract/schemas/digit.accounts.v1.schema.json'), 'ignored');
});

test('image source is reported as changing exactly that image', () => {
  assert.deepEqual(changed(['backend/pgr-services/src/main/java/org/egov/pgr/web/Foo.java']), ['pgr-services']);
  assert.deepEqual(changed(['backend/pgr-services/src/main/resources/db/migration/main/V1__x.sql']), ['pgr-services-db']);
  assert.deepEqual(changed(['backend/pgr-services/pom.xml', 'build/maven/Dockerfile']), ['pgr-services']);
  assert.deepEqual(changed(['backend/identity-bff/src/routes.ts']), ['identity-bff']);
  assert.deepEqual(changed(['keycloak/realm.json']), ['identity-keycloak']);
  assert.deepEqual(changed(['keycloak/tests/realm.test.mjs']), []);
  assert.deepEqual(changed(['digit-ui-esbuild/src/App.js']), ['digit-ui-esbuild']);
  assert.deepEqual(changed(['ui-shared/src/x.ts', 'configurator/src/App.tsx']), ['configurator']);
  // Unit tests inside an image's source do not rebuild it.
  assert.deepEqual(changed(['backend/pgr-services/src/test/java/X.java']), []);
});

test('every run builds every stack image, with its recipe', () => {
  const p = plan(['configurator/src/App.tsx', 'backend/pgr-services/src/main/java/A.java', 'configurator/src/B.tsx']);
  assert.deepEqual(p.changed, ['pgr-services', 'configurator']);
  assert.deepEqual(p.build.map(i => i.image),
    ['pgr-services-db', 'pgr-services', 'identity-bff', 'identity-keycloak', 'digit-ui-esbuild', 'configurator']);
  assert.deepEqual(plan(['local-setup/kong/kong.yml']).build, p.build);
  const pgr = p.build.find(i => i.image === 'pgr-services');
  assert.equal(pgr.var, 'pgr_services_image');
  assert.equal(pgr.context, '.');
  assert.equal(pgr.dockerfile, 'build/maven/Dockerfile');
  assert.equal(pgr.buildArgs, 'WORK_DIR=backend/pgr-services');
  // No dockerfile in the recipe → the context's own Dockerfile, as build-images.yml does.
  assert.equal(p.build[0].dockerfile, 'backend/pgr-services/src/main/resources/db/Dockerfile');
});

test('services the CI profile does not start are ignored, not built', () => {
  assert.equal(kind('backend/novu-bridge/src/main/java/X.java'), 'ignored');
  assert.equal(kind('backend/xstate-chatbot/nodejs/src/x.js'), 'ignored');
  assert.equal(kind('frontend/micro-ui/web/src/App.js'), 'ignored');
  assert.equal(kind('utilities/crs_dataloader/loader.py'), 'ignored');
  // ...but the MDMS schemas the playbook reads from default-data-handler are runtime.
  assert.equal(kind('utilities/default-data-handler/src/main/resources/schema/RAINMAKER-PGR.json'), 'runtime');
});

test('summary lists every file with its effect', () => {
  const s = summary(plan(['docs/a.md', 'backend/pgr-services/src/main/java/A.java']));
  assert.match(s, /Integration tests: run/);
  assert.match(s, /`pgr-services`/);
  assert.match(s, /\| `docs\/a\.md` \| ignored \(docs\) \|/);
});
