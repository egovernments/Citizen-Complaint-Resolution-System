// build.mjs — esbuild bundler for digit-workflow-designer.
// Usage:
//   node build.mjs            # one-shot build
//   node build.mjs --watch    # rebuild on change

import * as esbuild from 'esbuild';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, 'src');
const DIST = resolve(__dirname, 'dist');
const WATCH = process.argv.includes('--watch');

async function ensureDist() {
  await mkdir(DIST, { recursive: true });
}

function shortHash(buf) {
  return createHash('sha1').update(buf).digest('hex').slice(0, 10);
}

async function copyAssets(buildHash) {
  // styles.css straight copy
  await copyFile(resolve(SRC, 'styles.css'), resolve(DIST, 'styles.css'));
  // index.html with {{BUILD_HASH}} substitution
  const html = await readFile(resolve(SRC, 'index.html'), 'utf8');
  await writeFile(resolve(DIST, 'index.html'), html.replaceAll('{{BUILD_HASH}}', buildHash));
}

const sharedOptions = {
  entryPoints: [resolve(SRC, 'app.jsx')],
  outfile: resolve(DIST, 'designer.js'),
  bundle: true,
  format: 'esm',
  target: ['es2020'],
  jsx: 'automatic',
  loader: { '.jsx': 'jsx', '.js': 'jsx' },
  sourcemap: true,
  minify: !WATCH,
  define: {
    'process.env.NODE_ENV': WATCH ? '"development"' : '"production"',
  },
  logLevel: 'info',
};

async function buildOnce() {
  await ensureDist();
  const result = await esbuild.build(sharedOptions);
  if (result.errors.length) {
    console.error('Build failed:', result.errors);
    process.exit(1);
  }
  const bundleBuf = await readFile(sharedOptions.outfile);
  const buildHash = shortHash(bundleBuf);
  await copyAssets(buildHash);
  console.log(`built dist/  hash=${buildHash}  bytes=${bundleBuf.length}`);
  return buildHash;
}

async function watch() {
  await ensureDist();
  const ctx = await esbuild.context({
    ...sharedOptions,
    plugins: [
      {
        name: 'copy-assets',
        setup(build) {
          build.onEnd(async (result) => {
            if (result.errors.length) return;
            try {
              const buf = await readFile(sharedOptions.outfile);
              const hash = shortHash(buf);
              await copyAssets(hash);
              console.log(`[watch] rebuilt  hash=${hash}  bytes=${buf.length}`);
            } catch (err) {
              console.warn('[watch] copyAssets failed', err);
            }
          });
        },
      },
    ],
  });
  await ctx.watch();
  console.log('watching src/ for changes…');
}

if (WATCH) {
  await watch();
} else {
  await buildOnce();
}
