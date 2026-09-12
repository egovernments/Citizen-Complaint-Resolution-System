import type { ToolGroup, ToolMetadata } from '../types/index.js';

/**
 * Resolve read-only mode from MCP_READ_ONLY, FAIL-CLOSED. Unset/empty, or an
 * explicit falsey word (false/0/no/off), is the ONLY way to get a full instance;
 * any other non-empty value — including near-misses like "TRUE", "yes", "on", or
 * a stray-space "1 " out of a ConfigMap/--set — resolves to read-only. Strict
 * equality would fail OPEN (full admin) on exactly those typos, which for a
 * security control is the wrong direction. Exported so tool handlers (which do
 * not hold a registry) can consult the same rule.
 */
export function readOnlyFromEnv(): boolean {
  const v = String(process.env.MCP_READ_ONLY ?? '').trim().toLowerCase();
  if (v === '') return false;
  return !['false', '0', 'no', 'off'].includes(v);
}

/**
 * Effective read-only mode for tool handlers, which do not hold a registry.
 *
 * The registry resolves read-only as `options.readOnly ?? readOnlyFromEnv()`, so
 * a handler that consults `readOnlyFromEnv()` on its own can DISAGREE with the
 * registry that dispatched it (e.g. a registry built `{ readOnly: true }` while
 * MCP_READ_ONLY is unset). To keep one source of truth, the server calls
 * `setEffectiveReadOnly(registry.isReadOnly())` once at startup and handlers read
 * `isReadOnlyEffective()`. Until that call it falls back to the env — same
 * fail-closed default as before, so nothing regresses if the setter is skipped.
 */
let effectiveReadOnly: boolean | undefined;

export function setEffectiveReadOnly(value: boolean): void {
  effectiveReadOnly = value;
}

export function isReadOnlyEffective(): boolean {
  return effectiveReadOnly ?? readOnlyFromEnv();
}

export class ToolRegistry {
  private tools: Map<string, ToolMetadata> = new Map();
  private enabledGroups: Set<ToolGroup> = new Set(['core', 'docs']);
  private onToolListChanged?: () => void;

  // Read-only mode. When on, write-risk tools are never registered (see
  // `register`), so the mutating surface is ABSENT rather than merely disabled:
  // it cannot be listed, enabled, or dispatched — on `/mcp` or on any `/v1`
  // route (they all resolve tools through `getTool` and 404 when missing).
  // Enabled per-instance via the MCP_READ_ONLY env var, so a publicly-exposed
  // instance can safely carry only reads. Defaults from the env; the constructor
  // option lets tests set it explicitly.
  private readonly readOnly: boolean;

  constructor(options?: { readOnly?: boolean }) {
    this.readOnly = options?.readOnly ?? readOnlyFromEnv();
  }

  isReadOnly(): boolean {
    return this.readOnly;
  }

  setToolListChangedCallback(cb: () => void): void {
    this.onToolListChanged = cb;
  }

  register(tool: ToolMetadata): void {
    // Read-only mode drops every write-risk tool so it can never be called.
    // `core` is exempt from the drop because its only write tools are session
    // bookkeeping (`init`, `session_checkpoint`) that touch local session state,
    // not DIGIT data, and dropping them would break the session-hint flow.
    //
    // `configure` is the one core tool that CAN mutate DIGIT (it self-grants
    // roles via userUpdate, and its `base_url` arg can be pointed anywhere): it
    // is `risk: read` and kept, because a read-only instance still needs it to
    // connect — so those two behaviours are refused inside its handler when
    // read-only (see mdms-tenant.ts). Everything else that mutates DIGIT data
    // (tenant_destroy, decrypt_data, snapshot_capture, *_create/_update,
    // workflow_create, ...) is `risk: write` in a non-core group and dropped here.
    if (this.readOnly && tool.risk === 'write' && tool.group !== 'core') {
      return;
    }
    this.tools.set(tool.name, tool);
  }

  getEnabledTools(): ToolMetadata[] {
    return Array.from(this.tools.values()).filter((t) =>
      this.enabledGroups.has(t.group)
    );
  }

  getAllTools(): ToolMetadata[] {
    return Array.from(this.tools.values());
  }

  getTool(name: string): ToolMetadata | undefined {
    return this.tools.get(name);
  }

  isToolEnabled(name: string): boolean {
    const tool = this.tools.get(name);
    if (!tool) return false;
    return this.enabledGroups.has(tool.group);
  }

  getEnabledGroups(): ToolGroup[] {
    return Array.from(this.enabledGroups);
  }

  enableGroups(groups: ToolGroup[]): { enabled: ToolGroup[]; alreadyEnabled: ToolGroup[] } {
    const enabled: ToolGroup[] = [];
    const alreadyEnabled: ToolGroup[] = [];

    for (const group of groups) {
      if (this.enabledGroups.has(group)) {
        alreadyEnabled.push(group);
      } else {
        this.enabledGroups.add(group);
        enabled.push(group);
      }
    }

    if (enabled.length > 0) {
      this.onToolListChanged?.();
    }

    return { enabled, alreadyEnabled };
  }

  disableGroups(groups: ToolGroup[]): { disabled: ToolGroup[]; wasNotEnabled: ToolGroup[] } {
    const disabled: ToolGroup[] = [];
    const wasNotEnabled: ToolGroup[] = [];

    for (const group of groups) {
      if (group === 'core') continue;
      if (this.enabledGroups.has(group)) {
        this.enabledGroups.delete(group);
        disabled.push(group);
      } else {
        wasNotEnabled.push(group);
      }
    }

    if (disabled.length > 0) {
      this.onToolListChanged?.();
    }

    return { disabled, wasNotEnabled };
  }

  getSummary(): {
    groups: Record<string, { enabled: boolean; tools: { name: string; category: string; risk: string }[] }>;
    totalTools: number;
    enabledTools: number;
  } {
    const groups: Record<string, { enabled: boolean; tools: { name: string; category: string; risk: string }[] }> = {};

    for (const tool of this.tools.values()) {
      if (!groups[tool.group]) {
        groups[tool.group] = {
          enabled: this.enabledGroups.has(tool.group),
          tools: [],
        };
      }
      groups[tool.group].tools.push({
        name: tool.name,
        category: tool.category,
        risk: tool.risk,
      });
    }

    return {
      groups,
      totalTools: this.tools.size,
      enabledTools: this.getEnabledTools().length,
    };
  }
}
