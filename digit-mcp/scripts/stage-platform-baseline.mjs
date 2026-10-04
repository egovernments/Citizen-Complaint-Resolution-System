import { copyFile, mkdir, readFile, access } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const canonical = new URL('../backend/pgr-services/src/main/resources/onboarding/platform-baseline-v1.json', root);
const staged = new URL('data/platform-baseline-v1.json', root);
let inMonorepo = true;
try { await access(canonical); } catch { inMonorepo = false; }
if (inMonorepo) {
  await mkdir(new URL('data/', root), { recursive: true });
  await copyFile(canonical, staged);
}
// Standalone packages receive data/ from CI/Ansible preparation before Docker build.
const seed = JSON.parse(await readFile(staged, 'utf8'));
if (seed.version !== '1' || !Array.isArray(seed.schemas) || !Array.isArray(seed.records)) {
  throw new Error('Missing or unsupported staged platform seed; prepare the canonical PGR resource before build');
}
for (const directory of ['src/data/', 'dist/data/']) {
  await mkdir(new URL(directory, root), { recursive: true });
  await copyFile(staged, new URL(`${directory}platform-baseline-v1.json`, root));
}
