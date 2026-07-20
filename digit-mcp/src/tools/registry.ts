import type { ToolGroup, ToolMetadata } from '../types/index.js';

export class ToolRegistry {
  private tools: Map<string, ToolMetadata> = new Map();
  private enabledGroups: Set<ToolGroup> = new Set(['core', 'docs']);
  private onToolListChanged?: () => void;

  setToolListChangedCallback(cb: () => void): void {
    this.onToolListChanged = cb;
  }

  register(tool: ToolMetadata): void {
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
