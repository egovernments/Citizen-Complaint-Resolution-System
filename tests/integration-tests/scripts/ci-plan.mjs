#!/usr/bin/env node
/**
 * ci-plan.mjs — decide whether the "Integration tests" workflow runs for a change.
 *
 * A run deploys a fresh stack on a GitHub runner and then runs this suite: well
 * over an hour. So it runs only when a changed file can change what the suite
 * sees.
 *
 * Every changed path gets exactly one class, first match wins:
 *   build    source of an image the CI stack runs
 *   ignored  cannot affect the deployed stack or the suite: docs, unit tests,
 *            other CI, and code for things the CI profile does not deploy
 *   runtime  everything else, including paths nobody listed here. Unknown paths
 *            run the suite: a missed skip costs an hour, a wrong skip hides a bug.
 *
 * The suite runs when at least one path is `build` or `runtime`.
 *
 * A run builds EVERY image in IMAGES from the checkout, not just the changed
 * ones: the compose defaults pin configurator and digit-ui-esbuild to 2.12.1
 * and the rest to the moving nightly-develop tag, so a stack of "defaults plus
 * what this PR touched" would test neither develop nor the PR, and a PR run and
 * the develop run it is compared with would differ in more than the PR. The
 * layer cache makes an unchanged image a near no-op. `changed` (the images this
 * change touches) is only reported.
 *
 * Usage (paths on stdin, one per line):
 *   git diff --name-only A B | node scripts/ci-plan.mjs            # JSON plan
 *   ... | node scripts/ci-plan.mjs --github                        # also writes
 *       $GITHUB_OUTPUT (run, build, reason) and $GITHUB_STEP_SUMMARY
 *
 * No npm dependencies: the planning job runs it before any `npm ci`.
 */
import fs from 'node:fs';

/**
 * The CCRS images the CI stack runs, all built from the checkout on every run;
 * `match` says which source paths change each one. `image` and `context` /
 * `dockerfile` / `buildArgs` mirror build/build-config.yml (what the nightly
 * builds); `var` is the host_vars pin from ccrs_image_catalog in
 * local-setup/ansible/inventory/group_vars/digit.yml, which outranks the
 * compose default. digit-mcp is not here: the CI profile sets build_mcp, so the
 * deploy builds it from the checkout itself.
 *
 * Images whose compose profile the CI profile leaves off (novu-bridge,
 * digit-config-service, digit-user-preferences-service, xstate-chatbot) are in
 * IGNORED instead: the stack never starts them, so a run could not test them.
 */
export const IMAGES = [
  {
    image: 'pgr-services-db',
    var: 'pgr_services_db_image',
    match: [/^backend\/pgr-services\/src\/main\/resources\/db\//],
    context: 'backend/pgr-services/src/main/resources/db',
  },
  {
    image: 'pgr-services',
    var: 'pgr_services_image',
    // Not src/main/resources/db/: the Flyway migrations ship as pgr-services-db.
    match: [/^backend\/pgr-services\/(pom\.xml|src\/main\/(?!resources\/db\/))/, /^build\/maven\//],
    context: '.',
    dockerfile: 'build/maven/Dockerfile',
    buildArgs: { WORK_DIR: 'backend/pgr-services' },
  },
  {
    image: 'identity-bff',
    var: 'identity_bff_image',
    match: [/^backend\/identity-bff\/(Dockerfile|package(-lock)?\.json|tsconfig\.json|src\/)/],
    context: 'backend/identity-bff',
    dockerfile: 'backend/identity-bff/Dockerfile',
  },
  {
    image: 'identity-keycloak',
    var: 'identity_keycloak_image',
    match: [/^keycloak\/(Dockerfile|configure-keycloak\.sh|realm\.json|theme-src\/)/],
    context: 'keycloak',
    dockerfile: 'keycloak/Dockerfile',
  },
  {
    image: 'digit-ui-esbuild',
    var: 'digit_ui_image',
    match: [/^digit-ui-esbuild\/(docker\/|package(-lock)?\.json|packages\/|products\/|scripts\/|src\/|public\/|esbuild\.build\.js|postcss\.config\.js|tailwind\.config\.ts)/],
    context: 'digit-ui-esbuild',
    dockerfile: 'digit-ui-esbuild/docker/Dockerfile',
  },
  {
    image: 'configurator',
    var: 'configurator_image',
    match: [/^configurator\//, /^ui-shared\//],
    context: '.',
    dockerfile: 'configurator/Dockerfile',
  },
];

/** [pattern, why] — paths that cannot change what a run of this suite sees. */
export const IGNORED = [
  // Unit tests and fixtures, wherever they live. Not the suite's own specs:
  // tests/integration-tests/tests/**/*.spec.ts is what a run executes.
  [/(^|\/)src\/test\//, 'unit tests'],
  [/(^|\/)__tests__\//, 'unit tests'],
  [/^(?!tests\/integration-tests\/tests\/).*\.(test|spec)\.[cm]?[jt]sx?$/, 'unit tests'],
  [/^tests\/integration-tests\/tests\/identity-unit\//, 'unit tests'],
  // Docs and repo metadata.
  [/\.(md|mdx|rst)$/i, 'docs'],
  // A docs/ folder, but not one inside src/: configurator/src/onboarding/docs/
  // is the in-app docs rail, i.e. code.
  [/^(?!.*\/src\/)(.*\/)?docs\//, 'docs'],
  [/^(LICENSE|CODEOWNERS|CODE_OF_CONDUCT|Jenkinsfile|\.coderabbit\.yaml|\.actignore|\.gitignore|\.gitmodules)$/, 'repo metadata'],
  [/^\.claude\//, 'repo metadata'],
  // Other workflows. This one and its scripts are runtime (see RUNTIME_FIRST).
  [/^\.github\//, 'other CI'],
  // Code the CI profile does not deploy.
  [/^devops\//, 'Kubernetes / Helm, not the compose stack'],
  [/^configs\//, 'Kubernetes configs, not the compose stack'],
  [/^local-setup\/k8s\//, 'Kubernetes, not the compose stack'],
  [/^local-setup\/(Tiltfile[^/]*|docker-compose\.(yml|core\.yml|tilt\.yml|deploy\.yaml|registry\.yml|bomet\.yml))$/, 'compose files the Ansible deploy does not use'],
  [/^local-setup\/(postman|tests)\//, 'local-setup test suites'],
  [/^local-setup\/ansible\/(tests|runbooks)\//, 'Ansible tests and runbooks'],
  [/^local-setup\/ansible\/inventory\/host_vars\/(?!ci\.yml\.example$)/, 'other tenants\' host_vars'],
  [/^backend\/(novu-bridge|novu-dashboard|digit-config-service|digit-user-preferences-service|xstate-chatbot)\//, 'notifications / chatbot stack, off in the CI profile'],
  [/^(frontend|digit-ui-v2|turbopass|performance|security_scan)\//, 'not deployed by the CI profile'],
  [/^utilities\/(?!default-data-handler\/src\/main\/resources\/)/, 'not deployed by the CI profile'],
  [/^tests\/(playwright|README)/, 'another test suite'],
  // Parts of this suite a run does not use: the dashboards, the on-box runner,
  // other boxes' env files, the catalog builder.
  [/^tests\/integration-tests\/(dashboard|dashboard-react-admin|runner)\//, 'integration-test dashboards / on-box runner'],
  [/^tests\/integration-tests\/deploy\/(?!expectations\/pg\.json$|pg\.env$)/, 'other deployments\' suite config'],
  [/^tests\/integration-tests\/(Makefile|WRITING-TESTS|playwright\.(dashboard|identity|local|onboarding)\.config\.ts$)/, 'other suite entry points'],
  [/^tests\/integration-tests\/scripts\/(build-catalog|publish|regression-alert|tag-tests|dashboard-)/, 'catalog / alert tooling'],
];

/** Runtime even though a broader IGNORED rule matches: the CI's own files. */
export const RUNTIME_FIRST = [
  /^\.github\/workflows\/integration-tests\.yml$/,
  /^tests\/integration-tests\/scripts\/ci-(plan|compare)\.mjs$/,
  /^tests\/integration-tests\/scripts\/ci-identities\.sh$/,
];

export function classify(path) {
  if (RUNTIME_FIRST.some(re => re.test(path))) return { kind: 'runtime' };
  for (const [re, why] of IGNORED) if (re.test(path)) return { kind: 'ignored', why };
  const images = IMAGES.filter(i => i.match.some(re => re.test(path))).map(i => i.image);
  if (images.length) return { kind: 'build', images };
  return { kind: 'runtime' };
}

export function plan(paths) {
  const files = [...new Set(paths.map(p => p.trim()).filter(Boolean))];
  const classified = files.map(path => ({ path, ...classify(path) }));
  const changed = IMAGES.filter(i => classified.some(c => c.kind === 'build' && c.images.includes(i.image)));
  const exercised = classified.filter(c => c.kind !== 'ignored');
  const run = exercised.length > 0;
  let reason;
  if (files.length === 0) reason = 'no changed files';
  else if (!run) reason = `all ${files.length} changed file(s) are outside what the CI stack runs`;
  else reason = `${exercised.length} of ${files.length} changed file(s) can change what the suite sees`;
  return {
    run,
    reason,
    changed: changed.map(i => i.image),
    build: IMAGES.map(({ image, var: v, context, dockerfile = `${context}/Dockerfile`, buildArgs = {} }) => ({
      image, var: v, context, dockerfile,
      buildArgs: Object.entries(buildArgs).map(([k, val]) => `${k}=${val}`).join('\n'),
    })),
    files: classified,
  };
}

export function summary(p, { limit = 30 } = {}) {
  const out = [`### Integration tests: ${p.run ? 'run' : 'skipped'}`, '', p.reason, ''];
  if (p.run) out.push(`Images this change touches: ${p.changed.length ? p.changed.map(i => `\`${i}\``).join(', ') : 'none'}. ` +
    `Every stack image is built from the checkout either way (unchanged ones come from the layer cache).`, '');
  const rows = p.files.slice(0, limit).map(f =>
    `| \`${f.path}\` | ${f.kind === 'build' ? `changes ${f.images.join(', ')}` : f.kind === 'ignored' ? `ignored (${f.why})` : 'runtime'} |`);
  if (rows.length) out.push('| Changed file | Effect |', '|---|---|', ...rows);
  if (p.files.length > limit) out.push('', `…and ${p.files.length - limit} more.`);
  return out.join('\n') + '\n';
}

function main() {
  const p = plan(fs.readFileSync(0, 'utf8').split('\n'));
  if (process.argv.includes('--github')) {
    const { GITHUB_OUTPUT, GITHUB_STEP_SUMMARY } = process.env;
    if (!GITHUB_OUTPUT) throw new Error('--github needs GITHUB_OUTPUT');
    fs.appendFileSync(GITHUB_OUTPUT, `run=${p.run}\nbuild=${JSON.stringify(p.build)}\nreason=${p.reason}\n`);
    if (GITHUB_STEP_SUMMARY) fs.appendFileSync(GITHUB_STEP_SUMMARY, summary(p));
  }
  process.stdout.write(JSON.stringify(p, null, 2) + '\n');
}

if (import.meta.url === `file://${process.argv[1]}`) main();
