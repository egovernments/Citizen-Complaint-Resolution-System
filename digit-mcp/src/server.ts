import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { ToolRegistry } from './tools/registry.js';
import { registerAllTools } from './tools/index.js';
import { ALL_GROUPS } from './types/index.js';
import type { ErrorCategory } from './types/index.js';
import { mcpLogger } from './logger.js';
import { sessionStore } from './services/session-store.js';
import { telemetry } from './services/telemetry.js';
import { ApiClientError } from './services/digit-api.js';
import { getErrorHint } from './utils/error-hints.js';

export interface CreateServerOptions {
  enableAllGroups?: boolean;
}

export function createServer(options?: CreateServerOptions): Server {
  const registry = new ToolRegistry();
  registerAllTools(registry);

  if (options?.enableAllGroups) {
    registry.enableGroups(ALL_GROUPS);
  }

  const server = new Server(
    {
      name: 'digit-mcp',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: { listChanged: true },
      },
    }
  );

  // Wire up the listChanged notification
  registry.setToolListChangedCallback(() => {
    server.sendToolListChanged().catch((err) => {
      console.error('Failed to send tool list changed notification:', err);
    });
  });

  // ListTools — only returns enabled tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: registry.getEnabledTools().map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  // Session tools that should not be nudged
  const SESSION_TOOLS = new Set(['session_checkpoint', 'init']);

  // CallTool — dispatches to handler with session tracking
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    const tool = registry.getTool(name);
    if (!tool) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ success: false, error: `Unknown tool: ${name}` }, null, 2),
          },
        ],
        isError: true,
      };
    }

    if (!registry.isToolEnabled(name)) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: `Tool "${name}" is in the "${tool.group}" group which is not currently enabled. Call enable_tools to enable it.`,
                activeGroups: registry.getEnabledGroups(),
                toolGroup: tool.group,
              },
              null,
              2
            ),
          },
        ],
        isError: true,
      };
    }

    const start = Date.now();
    const sanitizedArgs = (args || {}) as Record<string, unknown>;
    mcpLogger.toolCall(name, sanitizedArgs);

    // Record tool call in session + telemetry
    const seq = sessionStore.recordToolCall(name, sanitizedArgs);
    telemetry.toolCall(name, tool.group);

    try {
      const result = await tool.handler(sanitizedArgs);
      const durationMs = Date.now() - start;
      mcpLogger.toolResult(name, durationMs, false);
      sessionStore.recordToolResult(seq, name, durationMs, false, result);

      // Nudge: suggest checkpoint after every N non-session tool calls
      let text = result;
      if (!SESSION_TOOLS.has(name) && sessionStore.shouldNudgeCheckpoint()) {
        text += '\n\n---\n**Hint**: Consider calling `session_checkpoint` to record your progress so far.';
      }

      return {
        content: [{ type: 'text', text }],
      };
    } catch (error) {
      const durationMs = Date.now() - start;
      const errorMsg = error instanceof Error ? error.message : String(error);
      mcpLogger.toolResult(name, durationMs, true);
      sessionStore.recordToolResult(seq, name, durationMs, true, '', errorMsg);
      telemetry.toolError(name, errorMsg);

      // Derive error category for agent-friendly error handling
      let category: ErrorCategory = 'internal';
      let code: number | undefined;
      if (error instanceof ApiClientError) {
        category = error.category;
        code = error.statusCode;
      } else if (error instanceof Error && error.name === 'ValidationError') {
        category = 'validation';
        code = 400;
      }

      const errorResponse: Record<string, unknown> = {
        success: false,
        error: errorMsg,
        category,
      };
      if (code !== undefined) errorResponse.code = code;
      const hint = getErrorHint(errorMsg);
      if (hint) errorResponse.hint = hint;

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(errorResponse, null, 2),
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}
