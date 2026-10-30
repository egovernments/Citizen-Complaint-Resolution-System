#!/usr/bin/env node
// Validates every edge in graph/*.json against the source tree.
//   node knowledge-graph/impact/validate.mjs            # report, exit 1 on any failure
//   node knowledge-graph/impact/validate.mjs --fix-lines # rewrite evidence.line when the match moved
// Checks: schema (prefixes, layers, rels), evidence file exists, evidence.match is on evidence.line
// (or elsewhere in the file: reported as "moved"), and no edge points at an undeclared node.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { GRAPH_DIR, LAYERS, PREFIXES, RELS, REPO_ROOT, canonicalId, loadGraph, prefixOf } from "./lib.mjs";

const fixLines = process.argv.includes("--fix-lines");
const { nodes, edges: all, files } = loadGraph();
const edges = all.filter((e) => e.status !== "derived");
const derived = all.length - edges.length;
const fileCache = new Map();
const readLines = (p) => {
  if (!fileCache.has(p)) fileCache.set(p, existsSync(join(REPO_ROOT, p)) ? readFileSync(join(REPO_ROOT, p), "utf8").split("\n") : null);
  return fileCache.get(p);
};

const problems = { schema: [], missingFile: [], missingMatch: [], moved: [], stubNode: [] };

for (const n of nodes.values()) {
  if (n.stub) { problems.stubNode.push(n.id); continue; }
  if (n.derived) continue;
  if (!PREFIXES.includes(prefixOf(n.id))) problems.schema.push(`node ${n.id}: unknown prefix`);
  if (!LAYERS.includes(n.layer)) problems.schema.push(`node ${n.id}: unknown layer ${n.layer}`);
}

const moves = new Map(); // source file -> [{edge, newLine}]
for (const e of edges) {
  const tag = `${e.source}: ${e.from} -[${e.rel}]-> ${e.to}`;
  if (!RELS.includes(e.rel)) problems.schema.push(`${tag}: unknown rel`);
  if (!["confirmed", "inferred"].includes(e.status)) problems.schema.push(`${tag}: bad status ${e.status}`);
  const ev = e.evidence || {};
  if (!ev.file || !ev.match) { problems.schema.push(`${tag}: evidence incomplete`); continue; }
  const lines = readLines(ev.file);
  if (!lines) { problems.missingFile.push(`${tag}: ${ev.file}`); continue; }
  if (lines[ev.line - 1]?.includes(ev.match)) continue;
  const at = lines.findIndex((l) => l.includes(ev.match));
  if (at === -1) { problems.missingMatch.push(`${tag}: "${ev.match}" not in ${ev.file}`); continue; }
  problems.moved.push(`${tag}: ${ev.file} line ${ev.line} → ${at + 1}`);
  if (!moves.has(e.source)) moves.set(e.source, []);
  moves.get(e.source).push({ e, line: at + 1 });
}

if (fixLines && moves.size) {
  for (const [src, list] of moves) {
    const path = join(GRAPH_DIR, src);
    const doc = JSON.parse(readFileSync(path, "utf8"));
    for (const { e, line } of list) {
      const target = doc.edges.find((d) => canonicalId(d.from) === e.from && canonicalId(d.to) === e.to && d.rel === e.rel && d.evidence?.match === e.evidence.match);
      if (target) target.evidence.line = line;
    }
    writeFileSync(path, JSON.stringify(doc, null, 2) + "\n");
  }
}

const confirmed = edges.filter((e) => e.status === "confirmed").length;
console.log(`Graph files: ${files.join(", ")}`);
console.log(`Nodes: ${[...nodes.values()].filter((n) => !n.stub).length} declared, ${problems.stubNode.length} referenced-only`);
console.log(`Edges: ${edges.length} with evidence (${confirmed} confirmed, ${edges.length - confirmed} inferred) + ${derived} derived api→service links`);
const show = (title, list, limit = 25) => {
  console.log(`\n${title}: ${list.length}`);
  for (const p of list.slice(0, limit)) console.log(`  - ${p}`);
  if (list.length > limit) console.log(`  … ${list.length - limit} more`);
};
show("Schema errors", problems.schema);
show("Evidence file missing", problems.missingFile);
show("Evidence text not found", problems.missingMatch);
show(fixLines ? "Line numbers corrected" : "Evidence moved (run --fix-lines)", problems.moved);
show("Nodes referenced but not declared", problems.stubNode);

const failed = problems.schema.length + problems.missingFile.length + problems.missingMatch.length;
console.log(failed ? `\nFAIL: ${failed} edge(s) could not be validated against source.` : "\nOK: every edge's evidence was found in source.");
process.exit(failed ? 1 : 0);
