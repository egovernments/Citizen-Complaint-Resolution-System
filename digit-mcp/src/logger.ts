import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { dirname } from 'node:path';
import { getRequestContext } from './services/request-context.js';
import { redactDeep } from './utils/redact.js';

class McpLogger {
  public readonly logPath: string;
  private stream: WriteStream;

  constructor() {
    this.logPath = process.env.MCP_LOG_FILE || '/var/log/digit-mcp/access.log';
    mkdirSync(dirname(this.logPath), { recursive: true });
    this.stream = createWriteStream(this.logPath, { flags: 'a' });
  }

  /**
   * Client context for the call being logged.
   *
   * Read from the request scope rather than from instance fields: on the HTTP
   * transport two concurrent requests would overwrite shared fields and
   * cross-attribute each other's tool calls. Empty under stdio, where the
   * session record already identifies the single owner.
   */
  private peer(): { ip?: string; ua?: string; user?: string } {
    const ctx = getRequestContext();
    if (!ctx) return {};
    return { ip: ctx.ip || undefined, ua: ctx.userAgent || undefined, user: ctx.userName };
  }

  /** Write a structured JSON log line */
  log(entry: Record<string, unknown>): void {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
    this.stream.write(line + '\n');
  }

  /** Log a tool call (called from server.ts CallTool handler) */
  toolCall(toolName: string, args: Record<string, unknown>): void {
    const peer = this.peer();
    this.log({
      event: 'tool_call',
      ip: peer.ip,
      ua: peer.ua,
      user: peer.user,
      tool: toolName,
      args: this.sanitize(args),
    });
  }

  /** Log a tool result (called from server.ts CallTool handler) */
  toolResult(toolName: string, durationMs: number, isError: boolean): void {
    this.log({
      event: 'tool_result',
      ip: this.peer().ip,
      tool: toolName,
      durationMs,
      error: isError || undefined,
    });
  }

  /**
   * Strip sensitive fields before logging. Substring match on the key name, at
   * any depth — the previous exact-name top-level check missed nested shapes
   * like `{ auth: { password } }` as well as `apiKey`-style names.
   */
  private sanitize(args: Record<string, unknown>): Record<string, unknown> {
    return redactDeep(args) as Record<string, unknown>;
  }
}

export const mcpLogger = new McpLogger();
