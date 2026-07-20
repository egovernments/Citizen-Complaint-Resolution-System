/**
 * One-shot tagger: walks every spec, infers tags from file path + describe
 * title + test title + heuristic content scan, and injects `{ tag: [...] }`
 * into each test() call. Idempotent — re-running merges new auto-tags into
 * any tag array already present without duplicating.
 *
 * Run:  npx tsx scripts/tag-tests.ts
 */
import { Project, Node, SyntaxKind, CallExpression, ObjectLiteralExpression, ArrowFunction, FunctionExpression } from 'ts-morph';
import * as path from 'path';

type Tag = string;

interface TestCallSite {
  filePath: string;
  describeTitles: string[];
  testTitle: string;
  call: CallExpression;
}

function deriveFileTags(filePath: string, fileContents: string): Tag[] {
  const rel = path.relative(process.cwd(), filePath).replace(/\\/g, '/');
  const tags: Set<Tag> = new Set();

  // Persona — from path
  if (/^tests\/citizen\//.test(rel)) tags.add('@persona:citizen');
  else if (/^tests\/employee\//.test(rel)) tags.add('@persona:employee');
  else if (/^tests\/admin\//.test(rel) || /^tests\/specs\/configurator\//.test(rel) || /^tests\/onboarding\//.test(rel)) tags.add('@persona:admin');
  else if (/^tests\/lifecycle\//.test(rel)) tags.add('@persona:cross');
  else if (/^tests\/specs\//.test(rel)) {
    // tests/specs/* — best-effort inference from filename
    if (/configurator|theme|mdms|mobile-validation/.test(rel)) tags.add('@persona:admin');
    else tags.add('@persona:cross');
  }

  // Area — from path + filename + content sniffing
  const fileName = path.basename(rel);
  if (/^tests\/onboarding\//.test(rel)) tags.add('@area:onboarding');
  if (/target-tenant-onboarding/.test(fileName)) tags.add('@area:onboarding');
  if (/login|logout|register|auth/.test(fileName)) tags.add('@area:auth');
  if (/pgr|complaint|wizard|rate|reopen|track|timeline|escalat|filestore|create-fixes|pin-and-cascade|postal/.test(fileName)) tags.add('@area:pgr');
  if (/(^|\/)theme/.test(fileName) || /theme-config|inspect-theme/.test(fileName)) tags.add('@area:theme');
  if (/localization/.test(fileName)) tags.add('@area:localization');
  if (/employees?|departments?|designations?|hrms|users?/.test(fileName)) tags.add('@area:hrms');
  if (/dashboard/.test(fileName)) tags.add('@area:dashboard');
  if (/mdms|configurator-mdms-fixes|debug-mdms/.test(fileName)) tags.add('@area:mdms-schema');
  if (/^tests\/admin\//.test(rel) || /^tests\/specs\/configurator\//.test(rel)) tags.add('@area:configurator-manage');
  if (/hardcoding|recently-shipped/.test(fileName)) tags.add('@area:configurator-manage');
  if (/aux-pages|home|profile|sidebar/.test(fileName)) tags.add('@area:pgr');
  // Fallback: at least one area
  const hasArea = Array.from(tags).some(t => t.startsWith('@area:'));
  if (!hasArea) tags.add('@area:pgr');

  // Layer — count UI vs API signals
  const uiHits = (fileContents.match(/page\.(goto|click|fill|locator|getByRole|getByText|getByLabel|waitFor)/g) || []).length;
  const apiHits = (fileContents.match(/\bfetch\s*\(|getDigitToken|mdmsCreate|mdmsSearch|workflowCreate|pgrCreate/g) || []).length;
  if (uiHits >= apiHits) tags.add('@layer:ui'); else tags.add('@layer:api');
  if (/^tests\/lifecycle\/.*-api\.spec\.ts$/.test(rel)) {
    tags.delete('@layer:ui');
    tags.add('@layer:api');
  }

  // Kind — file-level default
  if (/^tests\/lifecycle\//.test(rel)) tags.add('@kind:lifecycle');
  else if (/-fixes(-\d{4}-\d{2}-\d{2})?\.spec\.ts$|recently-shipped-fixes|configurator-mdms-fixes/.test(fileName)) tags.add('@kind:regression');
  else if (/smoke/.test(fileName)) tags.add('@kind:smoke');
  // else: filled in per-test below

  return Array.from(tags);
}

function deriveTestTags(testTitle: string, describeTitles: string[]): Tag[] {
  const tags: Set<Tag> = new Set();
  const fullText = [testTitle, ...describeTitles].join(' ');

  // Ticket numbers — CCRS issue references
  const ccrsMatches = fullText.match(/(?:CCRS\s*)?#(\d+)/g) || [];
  for (const m of ccrsMatches) {
    const num = m.replace(/\D/g, '');
    if (num) tags.add(`@ccrs:${num}`);
  }
  const prMatches = fullText.match(/PR\s*#(\d+)/gi) || [];
  for (const m of prMatches) {
    const num = m.replace(/\D/g, '');
    if (num) tags.add(`@pr:${num}`);
  }

  // Per-test kind hints
  if (/happy[- ]path/i.test(fullText)) tags.add('@kind:happy-path');
  if (/\b(invalid|reject(ed|s)?|error|missing|empty|edge)\b/i.test(fullText)) tags.add('@kind:edge-case');
  if (/\bsmoke\b/i.test(fullText)) tags.add('@kind:smoke');

  return Array.from(tags);
}

function ensureKindIfMissing(tags: Set<Tag>): void {
  const hasKind = Array.from(tags).some(t => t.startsWith('@kind:'));
  if (!hasKind) tags.add('@kind:regression');
}

/**
 * Find all test() / test.skip() / test.only() / test.fixme() calls.
 * Skip test.describe — that's not a test, it's a grouping.
 * Returns the CallExpression nodes plus context.
 */
function collectTestCalls(sourceFile: ReturnType<Project['getSourceFile']>): TestCallSite[] {
  const sites: TestCallSite[] = [];
  if (!sourceFile) return sites;

  const filePath = sourceFile.getFilePath();
  // Walk into describe blocks, tracking title stack.
  function walk(node: Node, describeStack: string[]): void {
    if (Node.isCallExpression(node)) {
      const expr = node.getExpression().getText();
      // describe: collect title and recurse with extended stack
      if (/^test\.describe(\.serial|\.parallel|\.only|\.skip)?$/.test(expr)) {
        const args = node.getArguments();
        if (args.length >= 2 && Node.isStringLiteral(args[0])) {
          const title = args[0].getLiteralText();
          const fnArg = args[args.length - 1];
          if (Node.isArrowFunction(fnArg) || Node.isFunctionExpression(fnArg)) {
            const body = fnArg.getBody();
            body.forEachChild(c => walk(c, [...describeStack, title]));
            return;
          }
        }
      }
      // test, test.skip, test.only, test.fixme: capture call site
      if (/^test(\.skip|\.only|\.fixme|\.slow|\.step)?$/.test(expr)) {
        const args = node.getArguments();
        if (args.length >= 1 && Node.isStringLiteral(args[0])) {
          const title = args[0].getLiteralText();
          sites.push({ filePath, describeTitles: [...describeStack], testTitle: title, call: node });
          // Don't recurse into the function body — no nested test()s.
          return;
        }
      }
    }
    node.forEachChild(c => walk(c, describeStack));
  }
  sourceFile.forEachChild(c => walk(c, []));
  return sites;
}

/**
 * Inject or merge `{ tag: [...] }` into a test() call.
 * Three shapes:
 *   test(title, fn)                      -> test(title, { tag: [...] }, fn)
 *   test(title, { ...other }, fn)        -> test(title, { ...other, tag: [...] }, fn)
 *   test(title, { tag: [...], ... }, fn) -> merge auto-tags into existing array
 */
function applyTagsToCall(call: CallExpression, autoTags: Tag[]): { added: number; merged: number } {
  const args = call.getArguments();
  if (args.length < 2) return { added: 0, merged: 0 };

  const title = args[0];
  const second = args[1];

  // Case A: 2nd arg is the function — insert options object before it.
  if (Node.isArrowFunction(second) || Node.isFunctionExpression(second)) {
    const tagArrayLiteral = `[${autoTags.map(t => `'${t}'`).join(', ')}]`;
    call.insertArgument(1, `{ tag: ${tagArrayLiteral} }`);
    return { added: autoTags.length, merged: 0 };
  }

  // Case B: 2nd arg is an options object literal.
  if (Node.isObjectLiteralExpression(second)) {
    const obj = second as ObjectLiteralExpression;
    const tagProp = obj.getProperty('tag');
    if (tagProp && Node.isPropertyAssignment(tagProp)) {
      const init = tagProp.getInitializer();
      if (init && Node.isArrayLiteralExpression(init)) {
        const existing = new Set(init.getElements().map(e => e.getText().replace(/^['"]|['"]$/g, '')));
        let merged = 0;
        for (const t of autoTags) {
          if (!existing.has(t)) {
            init.addElement(`'${t}'`);
            merged++;
          }
        }
        return { added: 0, merged };
      }
    }
    // No `tag` property — add one.
    const tagArrayLiteral = `[${autoTags.map(t => `'${t}'`).join(', ')}]`;
    obj.addPropertyAssignment({ name: 'tag', initializer: tagArrayLiteral });
    return { added: autoTags.length, merged: 0 };
  }

  // Other shapes (e.g. tagged template, dynamic) — leave alone, log.
  console.warn(`  ⚠ unrecognized 2nd arg shape at ${call.getSourceFile().getBaseName()}:${call.getStartLineNumber()}`);
  return { added: 0, merged: 0 };
}

async function main() {
  const project = new Project({
    tsConfigFilePath: 'tsconfig.json',
    skipAddingFilesFromTsConfig: true,
  });
  project.addSourceFilesAtPaths('tests/**/*.spec.ts');

  const totals = { files: 0, tests: 0, added: 0, merged: 0 };
  for (const sf of project.getSourceFiles()) {
    totals.files++;
    const filePath = sf.getFilePath();
    const fileContents = sf.getFullText();
    const fileTags = deriveFileTags(filePath, fileContents);

    const sites = collectTestCalls(sf);
    if (!sites.length) continue;

    let touched = false;
    for (const site of sites) {
      totals.tests++;
      const tagSet = new Set<Tag>([
        ...fileTags,
        ...deriveTestTags(site.testTitle, site.describeTitles),
      ]);
      ensureKindIfMissing(tagSet);
      const sortedTags = Array.from(tagSet).sort();
      const { added, merged } = applyTagsToCall(site.call, sortedTags);
      totals.added += added;
      totals.merged += merged;
      if (added || merged) touched = true;
    }

    if (touched) {
      await sf.save();
      const rel = path.relative(process.cwd(), filePath);
      console.log(`  ✓ ${rel}: ${sites.length} test(s)`);
    }
  }

  console.log(`\nDone. ${totals.files} files, ${totals.tests} tests, ${totals.added} new tag-arrays, ${totals.merged} merged into existing.`);
}

main().catch(e => { console.error(e); process.exit(1); });
