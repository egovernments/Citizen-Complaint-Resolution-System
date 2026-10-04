import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

const root = path.resolve(__dirname, '../../..');
const buildScript = path.join(root, 'local-setup/ansible/files/mcp-build.sh');
const canonical = 'backend/pgr-services/src/main/resources/onboarding/platform-baseline-v1.json';

describe('MCP baseline build preparation', () => {
  let temp: string;
  let repo: string;
  let seed: string;
  let bin: string;

  beforeEach(() => {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-seed-'));
    repo = path.join(temp, 'source with spaces');
    seed = path.join(temp, 'canonical seed.json');
    bin = path.join(temp, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(seed, '{"version":"1","schemas":[],"records":[]}\n');
    // Docker is a local stub: every build must receive the current seed bytes.
    fs.writeFileSync(path.join(bin, 'docker'), `#!/bin/sh
case "$1" in
  build|buildx) cmp "$SEED_EXPECTED" data/platform-baseline-v1.json || exit 43 ;;
esac
printf '%s\\n' "$1" >> "$CALL_LOG"
`, { mode: 0o755 });
    // Simulate the fresh clone path without network access.
    fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh
if [ "$1" = clone ]; then
  for destination do :; done
  mkdir -p "$destination"
  printf 'FROM scratch\\n' > "$destination/Dockerfile"
fi
`, { mode: 0o755 });
  });

  afterEach(() => fs.rmSync(temp, { recursive: true, force: true }));

  function run(source: string, seedPath = seed, platform = '') {
    return spawnSync('bash', [buildScript, repo, source, 'main', 'digit-mcp:test', platform, seedPath], {
      encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`,
        SEED_EXPECTED: seed, CALL_LOG: path.join(temp, 'calls') },
    });
  }

  test('vendored build replaces a stale generated seed before Docker reads it', () => {
    fs.mkdirSync(path.join(repo, 'data'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'Dockerfile'), 'FROM scratch\n');
    fs.writeFileSync(path.join(repo, 'data/platform-baseline-v1.json'), 'stale');
    const result = run('-');
    expect(result.stderr).not.toContain('ERROR');
    expect(result.status).toBe(0);
    expect(fs.readFileSync(path.join(temp, 'calls'), 'utf8')).toBe('build\nimage\n');
    expect(result.stdout.trim()).toBe('digit-mcp:test');
  });

  test('fresh clone is prepared after checkout and before a platform build', () => {
    const result = run('https://example.invalid/mcp.git', seed, 'linux/amd64');
    expect(result.status).toBe(0);
    expect(fs.readFileSync(path.join(temp, 'calls'), 'utf8')).toBe('buildx\nimage\n');
    expect(fs.readFileSync(path.join(repo, 'data/platform-baseline-v1.json'))).toEqual(fs.readFileSync(seed));
  });

  test('missing canonical seed stops before clone or build', () => {
    const result = run('https://example.invalid/mcp.git', path.join(temp, 'missing.json'));
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('canonical platform baseline is required');
    expect(fs.existsSync(repo)).toBe(false);
    expect(fs.existsSync(path.join(temp, 'calls'))).toBe(false);
  });

  test('both image workflows stage the seed for MCP before the build', () => {
    for (const workflow of ['build-images.yml', 'spa-build.yml']) {
      const content = fs.readFileSync(path.join(root, '.github/workflows', workflow), 'utf8');
      const stage = content.indexOf('run: node digit-mcp/scripts/stage-platform-baseline.mjs');
      expect(stage).toBeGreaterThan(0);
      expect(stage).toBeLessThan(content.indexOf('docker buildx build'));
      expect(content).toMatch(/if: (matrix.target.workdir|needs.resolve-config.outputs.work_dir) == 'digit-mcp'/);
    }
  });

  test('Ansible copies the canonical resource for target and opt-in controller builds', () => {
    const playbook = fs.readFileSync(path.join(root, 'local-setup/ansible/playbook-deploy.yml'), 'utf8');
    expect(playbook.split(`src: "{{ playbook_dir }}/../../${canonical}"`)).toHaveLength(3);
    expect(playbook).toContain('dest: /root/DIGIT-MCP/data/platform-baseline-v1.json');
    expect(playbook).toContain('dest: "{{ digit_dir }}/.build/platform-baseline-v1.json"');
    expect(playbook).toContain('- "{{ digit_dir }}/.build/platform-baseline-v1.json"');
  });
});
