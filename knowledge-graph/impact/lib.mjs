// Shared loader for the impact graph: reads graph/*.json, merges nodes by id, keeps every edge.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, "..", "..");
export const GRAPH_DIR = join(HERE, "graph");

export const LAYERS = ["business", "application", "data", "integration", "infrastructure"];

export const PREFIXES = [
  "api", "coreapi", "class", "code", "screen", "table", "field", "topic", "master",
  "wf", "config", "service", "infra", "test", "ext", "biz",
];

export const RELS = [
  "exposes", "handled-by", "calls", "invokes", "publishes", "consumes", "reads", "writes",
  "maps", "uses-config", "uses-state", "renders", "derives-from", "part-of", "routes-to",
  "deploys", "builds", "tests", "realises", "transitions-to",
];

export const prefixOf = (id) => id.split(":")[0];

// The layer is a property of the node type, so every pass agrees on it.
export const LAYER_BY_PREFIX = {
  biz: "business", wf: "business",
  screen: "application", api: "application", class: "application", code: "application", config: "application", test: "application",
  table: "data", field: "data", master: "data",
  topic: "integration", coreapi: "integration", ext: "integration",
  service: "infrastructure", infra: "infrastructure",
};

// Same endpoint written two ways. Evidence: local-setup/nginx/mdms-proxy.conf rewrites
// /egov-mdms-service/(.*) to /mdms-v2/$1; MDMS v2 create/update take the schema code as a path suffix.
const ALIASES = [
  [/^coreapi:\/egov-mdms-service\//, "coreapi:/mdms-v2/"],
  [/^(coreapi:\/mdms-v2\/v2\/_(?:create|update))\/.+$/, "$1"],
];
export const canonicalId = (id) => ALIASES.reduce((s, [re, to]) => s.replace(re, to), id);

// Context path → deployable that serves it. Used to derive api/coreapi → service links.
const OWNER_BY_PATH = [
  ["/pgr-services/", "service:pgr-services"], ["/novu-bridge/", "service:novu-bridge"],
  ["/identity/", "service:identity-bff"], ["/internal/identity/", "service:identity-bff"],
  ["/user-preference/", "service:digit-user-preferences-service"], ["/config-service/", "service:digit-config-service"],
  ["/user/", "service:egov-user"], ["/mdms-v2/", "service:mdms-v2"], ["/localization/", "service:egov-localization"],
  ["/boundary-service/", "service:boundary-service"], ["/filestore/", "service:egov-filestore"],
  ["/egov-url-shortening/", "service:egov-url-shortening"], ["/egov-enc-service/", "service:egov-enc-service"],
  ["/egov-workflow-v2/", "service:egov-workflow-v2"], ["/egov-hrms/", "service:egov-hrms"], ["/inbox/", "service:inbox"],
  ["/otp/", "service:egov-otp"], ["/access/", "service:egov-accesscontrol"], ["/egov-idgen/", "service:egov-idgen"],
  ["/realms/", "service:keycloak"], ["/admin/", "service:keycloak"],
];
const ownerOf = (id) => {
  const path = id.replace(/^(?:api|coreapi):(?:[A-Z]+ )?/, "");
  return OWNER_BY_PATH.find(([p]) => path.startsWith(p))?.[1];
};

export function loadGraph() {
  const files = readdirSync(GRAPH_DIR).filter((f) => f.endsWith(".json")).sort();
  const nodes = new Map();
  const edges = [];
  for (const f of files) {
    const doc = JSON.parse(readFileSync(join(GRAPH_DIR, f), "utf8"));
    for (const raw of doc.nodes) {
      const id = canonicalId(raw.id);
      const prev = nodes.get(id);
      if (!prev) {
        nodes.set(id, { ...raw, id, layer: LAYER_BY_PREFIX[prefixOf(id)], modules: [doc.module], sources: [f] });
      } else {
        if (!prev.modules.includes(doc.module)) prev.modules.push(doc.module);
        if (!prev.sources.includes(f)) prev.sources.push(f);
      }
    }
    for (const e of doc.edges) edges.push({ ...e, from: canonicalId(e.from), to: canonicalId(e.to), source: f, module: doc.module });
  }
  // Nodes referenced by an edge but declared nowhere get a stub so traversal still works.
  for (const e of edges) {
    for (const id of [e.from, e.to]) {
      if (!nodes.has(id)) nodes.set(id, { id, label: id.slice(id.indexOf(":") + 1), layer: LAYER_BY_PREFIX[prefixOf(id)], modules: [], sources: [], stub: true });
    }
  }
  // Derived links: every endpoint is part of the deployable that serves its context path.
  // These carry no evidence line (the rule above is the evidence) and are skipped by validate.mjs.
  for (const id of [...nodes.keys()]) {
    const owner = ["api", "coreapi"].includes(prefixOf(id)) && ownerOf(id);
    if (!owner) continue;
    if (!nodes.has(owner)) nodes.set(owner, { id: owner, label: owner.slice(8), layer: "infrastructure", modules: [], sources: [], derived: true });
    edges.push({ from: id, to: owner, rel: "part-of", status: "derived", source: "lib.mjs", module: "derived", note: "context path → deployable" });
  }
  return { nodes, edges, files };
}

// Reverse adjacency: dependency -> edges whose `to` is that node (i.e. its dependents).
export function dependentsIndex(edges) {
  const idx = new Map();
  for (const e of edges) {
    if (!idx.has(e.to)) idx.set(e.to, []);
    idx.get(e.to).push(e);
  }
  return idx;
}

export function dependenciesIndex(edges) {
  const idx = new Map();
  for (const e of edges) {
    if (!idx.has(e.from)) idx.set(e.from, []);
    idx.get(e.from).push(e);
  }
  return idx;
}
