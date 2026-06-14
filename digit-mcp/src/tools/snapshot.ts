import { readFileSync, writeFileSync } from 'node:fs';
import type { ToolMetadata } from '../types/index.js';
import type { ToolRegistry } from './registry.js';
import { digitApi } from '../services/digit-api.js';
import {
  captureSnapshot,
  diffSnapshots,
  ALL_LAYERS,
  type Snapshot,
  type SnapshotLayer,
} from '../services/snapshot.js';

const MCP_VERSION = process.env.MCP_VERSION || '1.0.0';

// Auto-login helper (only needed for config/data API sub-probes).
async function ensureAuthenticated(): Promise<void> {
  if (digitApi.isAuthenticated()) return;
  const username = process.env.CRS_USERNAME;
  const password = process.env.CRS_PASSWORD;
  const tenantId = process.env.CRS_TENANT_ID || digitApi.getEnvironmentInfo().stateTenantId;
  if (!username || !password) return; // capture proceeds; API layers degrade gracefully
  await digitApi.login(username, password, tenantId);
}

/** Resolve a diff side: a file path, an inline snapshot object, or live capture. */
async function resolveSide(side: unknown, label: string): Promise<Snapshot> {
  if (typeof side === 'string') {
    return JSON.parse(readFileSync(side, 'utf-8')) as Snapshot;
  }
  if (side && typeof side === 'object') {
    const obj = side as Record<string, unknown>;
    if (obj.capture && typeof obj.capture === 'object') {
      const cap = obj.capture as Record<string, unknown>;
      await ensureAuthenticated();
      return captureSnapshot({
        layers: (cap.layers as SnapshotLayer[]) || ALL_LAYERS,
        tenantId: (cap.tenant_id as string) || digitApi.getEnvironmentInfo().stateTenantId,
        label: (cap.label as string) || label,
        redact: cap.redact !== false,
        mcpVersion: MCP_VERSION,
      });
    }
    if (obj.$schema || obj.meta) return side as Snapshot;
  }
  throw new Error(`Invalid diff side "${label}": expected a file path, a snapshot object, or {capture:{tenant_id}}`);
}

export function registerSnapshotTools(registry: ToolRegistry): void {
  registry.register({
    name: 'snapshot_capture',
    group: 'snapshot',
    category: 'snapshot',
    risk: 'read',
    description:
      'Capture a portable, deterministic system-state snapshot of the CURRENT DIGIT deployment, to diff against another setup and explain replication deviations. ' +
      'Layers: "images" (running container image refs+digests from docker, plus declared compose refs → catches compose drift; ON-BOX only), ' +
      '"config" (container env with secrets redacted to hashes; MDMS StateInfo/UserValidation/tenants; workflow business services), ' +
      '"data" (row-count + code-set fingerprints for boundary/role/businessService, and a PII-free encryption-key canary). ' +
      'Only fingerprints/hashes are emitted — never raw rows or PII — so the artifact is safe to share. ' +
      'Layers degrade gracefully: each records its reachability (docker needs on-box access; MDMS/canary work remotely; DB row-counts need a reachable DB). ' +
      'Provide output_path to write the (potentially large) artifact to a file and return only metadata.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        layers: {
          type: 'array',
          items: { type: 'string', enum: ALL_LAYERS as unknown as string[] },
          description: 'Which layers to capture. Default: all (["images","config","data"]).',
        },
        tenant_id: { type: 'string', description: 'Tenant to scope config/data layers (e.g. "ke.bomet"). Defaults to the environment state tenant.' },
        label: { type: 'string', description: 'Human label stored in the snapshot (e.g. "bomet-prod", "fresh-clone").' },
        redact: { type: 'boolean', description: 'Redact secret-looking env values to hashes (default true). Keep true for shareable artifacts.' },
        output_path: { type: 'string', description: 'Absolute path to write the JSON artifact. When set, the tool returns only meta + reachability + path.' },
      },
    },
    handler: async (args) => {
      const layers = (args.layers as SnapshotLayer[]) || ALL_LAYERS;
      const tenantId = (args.tenant_id as string) || digitApi.getEnvironmentInfo().stateTenantId;
      const label = (args.label as string) || `snapshot-${tenantId}`;
      const redact = args.redact !== false;

      if (layers.some((l) => l === 'config' || l === 'data')) {
        await ensureAuthenticated();
      }

      const snapshot = await captureSnapshot({ layers, tenantId, label, redact, mcpVersion: MCP_VERSION });

      if (args.output_path) {
        const path = args.output_path as string;
        writeFileSync(path, JSON.stringify(snapshot, null, 2));
        return JSON.stringify({ success: true, outputPath: path, meta: snapshot.meta }, null, 2);
      }
      return JSON.stringify({ success: true, snapshot }, null, 2);
    },
  } satisfies ToolMetadata);

  registry.register({
    name: 'snapshot_diff',
    group: 'snapshot',
    category: 'snapshot',
    risk: 'read',
    description:
      'Diff two system-state snapshots and report deviations per layer (images/config/data) with severity. ' +
      'Pure comparison — no infra access needed, so it runs anywhere on two captured artifacts. ' +
      'Each of a/b may be: a file path to a snapshot JSON, an inline snapshot object, or {"capture":{"tenant_id":"..."}} to capture the current environment live. ' +
      'Findings include image digest mismatches, compose declared-vs-running drift, env/MDMS/workflow config diffs (secrets compared by hash only), ' +
      'row-count deltas, code-set differences (which boundary/role codes one side is missing), and encryption-key canary mismatches.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        a: { description: 'Side A: file path (string), inline snapshot object, or {"capture":{...}} for a live capture.' },
        b: { description: 'Side B: file path (string), inline snapshot object, or {"capture":{...}} for a live capture.' },
        layers: {
          type: 'array',
          items: { type: 'string', enum: ALL_LAYERS as unknown as string[] },
          description: 'Restrict the diff to these layers. Default: all layers present in both snapshots.',
        },
      },
      required: ['a', 'b'],
    },
    handler: async (args) => {
      const a = await resolveSide(args.a, 'A');
      const b = await resolveSide(args.b, 'B');
      const report = diffSnapshots(a, b, args.layers as SnapshotLayer[] | undefined);
      return JSON.stringify(report, null, 2);
    },
  } satisfies ToolMetadata);
}
