/**
 * Shared helpers for agent-based MCP flow tests.
 *
 * Uses the V1 `query()` API from @anthropic-ai/claude-agent-sdk.
 * Each `sendPrompt()` call starts a fresh subprocess + MCP server.
 * The MCP server auto-authenticates via CRS_USERNAME/CRS_PASSWORD env vars,
 * so no session state is needed between calls.
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import path from "node:path";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ToolCall {
  name: string;
  id: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  toolUseId: string;
  toolName: string;
  content: string;
  parsed: Record<string, unknown> | null;
}

export interface TurnResult {
  text: string;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  sessionId: string;
  costUsd: number;
  durationMs: number;
  numTurns: number;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MODEL = process.env.AGENT_TEST_MODEL ?? "claude-sonnet-4-5-20250929";

/** When true, log full conversation (Claude text, tool calls, tool results). */
export let VERBOSE = process.env.AGENT_TEST_VERBOSE === "1" || process.argv.includes("--verbose");

export function setVerbose(v: boolean) {
  VERBOSE = v;
}

const SERVER_PATH = path.resolve(
  import.meta.dirname ?? new URL(".", import.meta.url).pathname,
  "../dist/index.js",
);

const MCP_SERVER_NAME = "digit";

function mcpServerConfig() {
  return {
    [MCP_SERVER_NAME]: {
      type: "stdio" as const,
      command: "node",
      args: [SERVER_PATH],
      env: {
        CRS_ENVIRONMENT: process.env.CRS_ENVIRONMENT ?? "chakshu-digit",
        CRS_API_URL: process.env.CRS_API_URL ?? "",
        CRS_USERNAME: process.env.CRS_USERNAME ?? "ADMIN",
        CRS_PASSWORD: process.env.CRS_PASSWORD ?? "eGov@123",
        CRS_STATE_TENANT: process.env.CRS_STATE_TENANT ?? "pg",
        // Pre-enable all tool groups so tools are available immediately
        MCP_ENABLE_ALL_GROUPS: "1",
        // Suppress MCP server logs to stderr
        MCP_LOG_FILE: "/dev/null",
        // Disable session DB in subprocesses — thoughts are pushed via REST instead
        SESSION_DB_URL: "disabled",
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Session viewer integration — push thought chain to viewer
// ---------------------------------------------------------------------------

const VIEWER_URL = process.env.SESSION_VIEWER_URL || "http://localhost:3100";
let viewerSessionId: string | null = null;
let globalTurn = 0;

/** Get/create the viewer session ID for this test run. */
export function getViewerSessionId(): string | null {
  return viewerSessionId;
}

async function pushMessagesToViewer(prompt: string, messages: SDKMessage[]): Promise<void> {
  if (!viewerSessionId) {
    viewerSessionId = randomUUID();
  }

  const viewerMessages: Array<{ turn: number; role: string; content: unknown[] }> = [];

  // User prompt
  globalTurn++;
  viewerMessages.push({
    turn: globalTurn,
    role: "user",
    content: [{ type: "text", text: prompt }],
  });

  for (const message of messages) {
    if (message.type === "assistant") {
      const msg = message as Record<string, unknown>;
      const content = msg.message as { content: Array<Record<string, unknown>> } | undefined;
      if (content?.content && content.content.length > 0) {
        globalTurn++;
        viewerMessages.push({
          turn: globalTurn,
          role: "assistant",
          content: content.content,
        });
      }
    }

    if (message.type === "user") {
      const msg = message as Record<string, unknown>;
      const content = msg.message as { content: Array<Record<string, unknown>> } | undefined;
      if (content?.content) {
        const hasToolResults = content.content.some((b) => b.type === "tool_result");
        if (hasToolResults) {
          globalTurn++;
          viewerMessages.push({
            turn: globalTurn,
            role: "tool_result",
            content: content.content,
          });
        }
      }
    }
  }

  try {
    const res = await fetch(`${VIEWER_URL}/api/sessions/${viewerSessionId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: viewerMessages, environment: "agent-test" }),
    });
    if (!res.ok) {
      console.error(`[viewer] Failed to push messages: ${res.status}`);
    }
  } catch {
    // Viewer might not be running — ignore silently
  }
}

// ---------------------------------------------------------------------------
// Message parsing
// ---------------------------------------------------------------------------

/** Truncate a string for verbose output. */
function truncate(s: string, max = 500): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `... (${s.length - max} more chars)`;
}

function parseMessages(messages: SDKMessage[]): TurnResult {
  const toolCalls: ToolCall[] = [];
  const toolResults: ToolResult[] = [];
  const textParts: string[] = [];
  const toolUseIdToName = new Map<string, string>();
  let sessionId = "";
  let costUsd = 0;
  let durationMs = 0;
  let numTurns = 0;
  let turnCounter = 0;

  for (const message of messages) {
    // System init
    if (message.type === "system" && "subtype" in message && message.subtype === "init") {
      sessionId = (message as Record<string, unknown>).session_id as string;
    }

    // Assistant message
    if (message.type === "assistant") {
      turnCounter++;
      const msg = message as Record<string, unknown>;
      const content = msg.message as { content: Array<Record<string, unknown>> } | undefined;
      if (content?.content) {
        if (VERBOSE) {
          console.log(`\n${V.cyan}━━━ Turn ${turnCounter} (Assistant) ━━━${V.reset}`);
        }
        for (const block of content.content) {
          if (block.type === "text") {
            textParts.push(block.text as string);
            if (VERBOSE) {
              console.log(`${V.dim}${truncate(block.text as string, 800)}${V.reset}`);
            }
          }
          if (block.type === "tool_use") {
            const tc: ToolCall = {
              name: block.name as string,
              id: block.id as string,
              input: block.input as Record<string, unknown>,
            };
            toolCalls.push(tc);
            toolUseIdToName.set(tc.id, tc.name);
            if (VERBOSE) {
              const sn = tc.name.split("__").pop();
              console.log(`${V.yellow}→ Tool Call: ${sn}${V.reset}`);
              console.log(`  ${V.dim}${truncate(JSON.stringify(tc.input, null, 2), 600)}${V.reset}`);
            }
          }
        }
      }
    }

    // User message containing tool results
    if (message.type === "user") {
      const msg = message as Record<string, unknown>;
      const content = msg.message as { content: Array<Record<string, unknown>> } | undefined;
      if (content?.content) {
        for (const block of content.content) {
          if (block.type === "tool_result") {
            const rawContent = block.content;
            let textContent = "";
            if (typeof rawContent === "string") {
              textContent = rawContent;
            } else if (Array.isArray(rawContent)) {
              textContent = rawContent
                .filter((c: Record<string, unknown>) => c.type === "text")
                .map((c: Record<string, unknown>) => c.text)
                .join("");
            }

            let parsed: Record<string, unknown> | null = null;
            try {
              parsed = JSON.parse(textContent);
            } catch {
              // not JSON
            }

            const toolName = toolUseIdToName.get(block.tool_use_id as string) ?? "unknown";
            toolResults.push({
              toolUseId: block.tool_use_id as string,
              toolName,
              content: textContent,
              parsed,
            });

            if (VERBOSE) {
              const sn = toolName.split("__").pop();
              const isError = block.is_error === true;
              const success = parsed?.success;
              const statusIcon = isError ? `${V.red}✗` : success === true ? `${V.green}✓` : `${V.yellow}?`;
              console.log(`${statusIcon} Tool Result: ${sn}${V.reset}`);
              console.log(`  ${V.dim}${truncate(textContent, 600)}${V.reset}`);
            }
          }
        }
      }
    }

    // Final result
    if (message.type === "result") {
      const r = message as Record<string, unknown>;
      sessionId = (r.session_id as string) ?? sessionId;
      costUsd = (r.total_cost_usd as number) ?? 0;
      durationMs = (r.duration_ms as number) ?? 0;
      numTurns = (r.num_turns as number) ?? 0;
      if (r.subtype === "success" && r.result) {
        textParts.push(r.result as string);
      }
      if (VERBOSE) {
        console.log(`\n${V.cyan}━━━ Result ━━━${V.reset}`);
        console.log(`${V.dim}Status: ${r.subtype} | Turns: ${numTurns} | Cost: $${costUsd.toFixed(4)}${V.reset}`);
        if (r.result) {
          console.log(`${V.dim}${truncate(r.result as string, 400)}${V.reset}`);
        }
      }
    }
  }

  return { text: textParts.join("\n"), toolCalls, toolResults, sessionId, costUsd, durationMs, numTurns };
}

/** Verbose logging colors (separate from flow colors). */
const V = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
};

// ---------------------------------------------------------------------------
// V1 query — each call is self-contained
// ---------------------------------------------------------------------------

/**
 * Send a prompt via V1 query() API. Each call starts a fresh subprocess +
 * MCP server. The MCP server auto-authenticates from env vars, so no session
 * state is needed between calls.
 */
export async function sendPrompt(
  prompt: string,
  opts?: { maxTurns?: number },
): Promise<TurnResult> {
  // Strip CLAUDECODE env var so the subprocess doesn't think it's nested
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.CLAUDECODE;

  const options = {
    mcpServers: mcpServerConfig(),
    allowedTools: [`mcp__${MCP_SERVER_NAME}__*`],
    permissionMode: "bypassPermissions" as const,
    allowDangerouslySkipPermissions: true,
    model: MODEL,
    maxTurns: opts?.maxTurns ?? 25,
    tools: [] as string[], // disable built-in tools; only MCP tools
    persistSession: false,
    env,
  };

  const messages: SDKMessage[] = [];
  for await (const message of query({ prompt, options: options as Parameters<typeof query>[0]["options"] })) {
    messages.push(message);
  }

  // Push thought chain to session viewer (best-effort, awaited so it completes before process exit)
  await pushMessagesToViewer(prompt, messages).catch(() => {});

  return parseMessages(messages);
}

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

export class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssertionError";
  }
}

export function assert(condition: boolean, message: string): void {
  if (!condition) throw new AssertionError(message);
}

/** Strip MCP prefix: mcp__digit__foo → foo */
function shortName(qualifiedName: string): string {
  const parts = qualifiedName.split("__");
  return parts[parts.length - 1];
}

/** Assert a specific tool was called (by short name). */
export function assertToolCalled(result: TurnResult, toolName: string): void {
  const found = result.toolCalls.some((tc) => shortName(tc.name) === toolName);
  assert(
    found,
    `Expected tool "${toolName}" to be called. Called: [${result.toolCalls.map((tc) => shortName(tc.name)).join(", ")}]`,
  );
}

/** Get the first parsed JSON result from a tool (by short name). */
export function getToolResult(result: TurnResult, toolName: string): Record<string, unknown> {
  const tr = result.toolResults.find((r) => shortName(r.toolName) === toolName);
  assert(
    tr !== undefined,
    `No tool result found for "${toolName}". Available: [${result.toolResults.map((r) => shortName(r.toolName)).join(", ")}]`,
  );
  assert(tr!.parsed !== null, `Tool result for "${toolName}" is not valid JSON: ${tr!.content.slice(0, 200)}`);
  return tr!.parsed!;
}

/** Get ALL parsed JSON results from a tool (may be called multiple times). */
export function getAllToolResults(result: TurnResult, toolName: string): Array<Record<string, unknown>> {
  return result.toolResults
    .filter((r) => shortName(r.toolName) === toolName)
    .map((r) => {
      assert(r.parsed !== null, `Tool result for "${toolName}" is not valid JSON`);
      return r.parsed!;
    });
}

/** Assert a tool returned { success: true }. */
export function assertSuccess(result: TurnResult, toolName: string): void {
  const data = getToolResult(result, toolName);
  assert(
    data.success === true,
    `Expected "${toolName}" to return success:true, got: ${JSON.stringify(data).slice(0, 300)}`,
  );
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

const C = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
};

export function logStep(step: number, total: number, description: string) {
  console.log(`  ${C.cyan}[${step}/${total}]${C.reset} ${description}`);
}

export function logToolCalls(result: TurnResult) {
  const names = result.toolCalls.map((tc) => shortName(tc.name));
  if (names.length > 0) {
    console.log(`        ${C.dim}Tools: ${names.join(" → ")}${C.reset}`);
  }
}

export function logCost(result: TurnResult) {
  console.log(
    `        ${C.dim}Cost: $${result.costUsd.toFixed(4)} | Turns: ${result.numTurns} | Time: ${(result.durationMs / 1000).toFixed(1)}s${C.reset}`,
  );
}
