import type { ToolGroup, ToolMetadata } from '../types/index.js';

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
    this.readOnly =
      options?.readOnly ??
      (process.env.MCP_READ_ONLY === 'true' || process.env.MCP_READ_ONLY === '1');
  }

  isReadOnly(): boolean {
    return this.readOnly;
  }

  setToolListChangedCallback(cb: () => void): void {
    this.onToolListChanged = cb;
  }

  register(tool: ToolMetadata): void {
    // Read-only mode drops every write-risk tool so it can never be called.
    // `core` is exempt: its only writes are session bookkeeping (`init`,
    // `session_checkpoint`) that touch local session state, not DIGIT data, and
    // dropping them would break the session-hint flow. Every data-mutating tool
    // (tenant_destroy, decrypt_data, *_create/_update, workflow_create, ...)
    // lives in a non-core group and is therefore excluded.
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
