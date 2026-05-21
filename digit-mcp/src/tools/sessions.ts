import type { ToolGroup, ToolMetadata } from '../types/index.js';
import { ALL_GROUPS } from '../types/index.js';
import type { ToolRegistry } from './registry.js';
import { sessionStore } from '../services/session-store.js';

function getSuggestedSteps(purpose: string): string[] {
  const steps: string[] = [];
  const p = purpose.toLowerCase();

  if (p.includes('pgr') || p.includes('complaint') || p.includes('grievance')) {
    steps.push('Use configure to connect to the DIGIT environment');
    steps.push('Use validate_complaint_types to check available complaint types');
    steps.push('Use pgr_create to file a complaint');
  } else if (p.includes('employee') || p.includes('hrms')) {
    steps.push('Use configure to connect to the DIGIT environment');
    steps.push('Use validate_departments and validate_designations to check master data');
    steps.push('Use employee_create to create employees');
  } else if (p.includes('tenant') || p.includes('setup')) {
    steps.push('Use configure to connect to the DIGIT environment');
    steps.push('Use tenant_bootstrap to set up a new tenant root');
    steps.push('Use boundary_create to define boundaries');
  } else if (p.includes('debug') || p.includes('monitor') || p.includes('trace')) {
    steps.push('Use configure to connect to the DIGIT environment');
    steps.push('Use health_check to verify services are running');
    steps.push('Use trace_debug to investigate failures');
  } else {
    steps.push('Use configure to connect to the DIGIT environment');
    steps.push('Use discover_tools to see available capabilities');
    steps.push('Use docs_search to find relevant documentation');
  }

  return steps;
}

export function registerSessionTools(registry: ToolRegistry): void {
  // init — session initialization, core group
  registry.register({
    name: 'init',
    group: 'core',
    category: 'sessions',
    risk: 'write',
    description:
      'Initialize a DIGIT MCP session. Call this at the start of a conversation to set up the session context. ' +
      'Before calling, ask the user: (1) their name, (2) what they want to accomplish (e.g. "set up PGR for a new tenant", ' +
      '"debug a failing complaint", "explore the API"), (3) whether to enable telemetry (session tracking for the viewer). ' +
      'The tool maps the user\'s intent to relevant tool groups and auto-enables them. ' +
      'Also pass client_name to identify your platform (e.g. "Claude Code", "Lovable", "Cursor").',
    inputSchema: {
      type: 'object' as const,
      properties: {
        user_name: {
          type: 'string',
          description: 'Name of the user (for session attribution)',
        },
        purpose: {
          type: 'string',
          description:
            'What the user wants to accomplish. Used to auto-enable relevant tool groups. ' +
            'Examples: "set up PGR complaints", "create employees", "debug API issues", "explore available tools"',
        },
        telemetry: {
          type: 'boolean',
          description: 'Whether to enable session telemetry (checkpoint tracking, viewer integration). Default: true',
        },
        client_name: {
          type: 'string',
          description:
            'Self-declared identity of the AI client or platform calling the MCP server. ' +
            'Examples: "Claude Code", "Lovable", "Cursor", "Windsurf", "custom-agent". ' +
            'This helps identify which tool is generating the session in the viewer.',
        },
      },
      required: ['purpose'],
    },
    handler: async (args) => {
      const userName = (args.user_name as string) || 'anonymous';
      const purpose = args.purpose as string;
      const telemetry = args.telemetry !== false; // default true
      const clientName = (args.client_name as string) || undefined;

      // 1. Record user context in session
      sessionStore.setUserContext(userName, purpose, telemetry, clientName);

      // 2. Map intent to tool groups
      const intentMap: Record<string, ToolGroup[]> = {
        'pgr':          ['pgr', 'masters', 'admin', 'boundary'],
        'complaint':    ['pgr', 'masters', 'admin', 'boundary'],
        'grievance':    ['pgr', 'masters', 'admin', 'boundary'],
        'employee':     ['employees', 'masters', 'admin'],
        'hrms':         ['employees', 'masters', 'admin'],
        'tenant':       ['mdms', 'boundary', 'masters', 'admin'],
        'setup':        ['mdms', 'boundary', 'masters', 'localization', 'admin'],
        'boundary':     ['boundary', 'mdms'],
        'mdms':         ['mdms'],
        'localization': ['localization'],
        'label':        ['localization'],
        'translation':  ['localization'],
        'monitor':      ['monitoring', 'tracing'],
        'debug':        ['monitoring', 'tracing', 'pgr'],
        'trace':        ['tracing'],
        'kafka':        ['monitoring'],
        'persister':    ['monitoring'],
        'encrypt':      ['encryption'],
        'id gen':       ['idgen'],
        'api':          ['docs'],
        'explore':      [],
        'all':          ALL_GROUPS.filter((g): g is ToolGroup => g !== 'core'),
      };

      const matched = new Set<ToolGroup>();
      const purposeLower = purpose.toLowerCase();
      for (const [keyword, groups] of Object.entries(intentMap)) {
        if (purposeLower.includes(keyword)) {
          for (const g of groups) matched.add(g);
        }
      }

      // Always ensure docs is available
      matched.add('docs');

      const toEnable = [...matched];
      if (toEnable.length > 0) {
        registry.enableGroups(toEnable);
      }

      const summary = registry.getSummary();
      const session = sessionStore.getSession();

      return JSON.stringify(
        {
          success: true,
          session: {
            id: session?.id,
            userName,
            purpose,
            telemetry,
            clientName: clientName || undefined,
          },
          enabledGroups: registry.getEnabledGroups(),
          toolCount: `${summary.enabledTools} of ${summary.totalTools} tools now enabled`,
          suggestedNextSteps: getSuggestedSteps(purpose),
        },
        null,
        2
      );
    },
  } satisfies ToolMetadata);

  // session_checkpoint — core group, always visible
  registry.register({
    name: 'session_checkpoint',
    group: 'core',
    category: 'sessions',
    risk: 'write',
    description:
      'Record a checkpoint summarizing your progress so far. Call this periodically (every 5-10 tool calls) to capture what you accomplished. The summary is persisted across sessions and searchable later.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        summary: {
          type: 'string',
          description:
            'What you accomplished since the last checkpoint (or session start). Be specific: mention tenants, services, errors resolved.',
        },
        messages: {
          type: 'array',
          description:
            'Conversation turns to persist. Each has: turn (sequence number), role (user|assistant|tool_result), content (array of Anthropic content blocks).',
          items: {
            type: 'object',
            properties: {
              turn: { type: 'integer' },
              role: { type: 'string' },
              content: { type: 'array' },
            },
            required: ['turn', 'role', 'content'],
          },
        },
      },
      required: ['summary'],
    },
    handler: async (args) => {
      const summary = args.summary as string;
      if (!summary || summary.trim().length === 0) {
        return JSON.stringify({ success: false, error: 'Summary is required' }, null, 2);
      }

      const messages = Array.isArray(args.messages) ? args.messages as Array<{turn: number; role: string; content: unknown}> : undefined;
      const checkpoint = sessionStore.recordCheckpoint(summary.trim(), messages);
      const session = sessionStore.getSession();

      return JSON.stringify(
        {
          success: true,
          checkpoint: {
            sessionId: checkpoint.sessionId,
            seq: checkpoint.seq,
            ts: checkpoint.ts,
            summary: checkpoint.summary,
            recentTools: checkpoint.recentTools,
          },
          session: session
            ? {
                toolCount: session.toolCount,
                checkpointCount: session.checkpointCount,
                errorCount: session.errorCount,
              }
            : null,
        },
        null,
        2
      );
    },
  } satisfies ToolMetadata);

}
