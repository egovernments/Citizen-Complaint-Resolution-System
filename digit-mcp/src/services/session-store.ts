import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { telemetry as matomo } from './telemetry.js';

// --- Types ---

interface SessionRecord {
  id: string;
  startedAt: string;
  environment: string;
  transport: 'stdio' | 'http';
  toolCount: number;
  checkpointCount: number;
  errorCount: number;
  toolSequence: string[];
  lastCheckpointSummary: string;
  userName?: string;
  purpose?: string;
  telemetry?: boolean;
  clientName?: string;
  userAgent?: string;
  clientIp?: string;
}

// --- Sensitive field sanitization (matches logger.ts) ---

const SENSITIVE_KEYS = ['password', 'secret', 'token', 'auth_token'];

function sanitizeArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out = { ...args };
  for (const key of SENSITIVE_KEYS) {
    if (key in out) out[key] = '***';
  }
  return out;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '...';
}

// --- SessionStore ---

const NUDGE_INTERVAL = 8;
const MAX_RECENT_TOOLS = 20;
const MAX_RESULT_SUMMARY_LEN = 200;
const SESSION_TOOLS = new Set(['session_checkpoint', 'init']);

class SessionStore {
  // JSONL fallback (always active)
  private dataDir: string;
  private eventsFile: string;
  private sessionsFile: string;
  private eventsStream: WriteStream | null = null;
  private sessionsStream: WriteStream | null = null;

  // In-memory state
  private session: SessionRecord | null = null;
  private seq = 0;
  private nudgeCounter = 0;

  constructor() {
    this.dataDir = process.env.SESSION_DATA_DIR || join(process.cwd(), 'data');
    this.eventsFile = join(this.dataDir, 'events.jsonl');
    this.sessionsFile = join(this.dataDir, 'sessions.jsonl');
  }

  // --- Session lifecycle ---

  async ensureSession(transport: 'stdio' | 'http'): Promise<void> {
    if (this.session) return;

    // JSONL: always set up (never fails)
    mkdirSync(this.dataDir, { recursive: true });
    this.eventsStream = createWriteStream(this.eventsFile, { flags: 'a' });
    this.sessionsStream = createWriteStream(this.sessionsFile, { flags: 'a' });

    // Postgres: best-effort (logs warning and continues if unavailable)
    await db.initialize();

    this.session = {
      id: randomUUID(),
      startedAt: new Date().toISOString(),
      environment: process.env.CRS_ENVIRONMENT || 'unknown',
      transport,
      toolCount: 0,
      checkpointCount: 0,
      errorCount: 0,
      toolSequence: [],
      lastCheckpointSummary: '',
    };

    this.seq = 0;
    this.nudgeCounter = 0;

    // Persist to DB (fire-and-forget)
    db.execute(
      `INSERT INTO sessions (id, started_at, environment, transport)
       VALUES ($1, $2, $3, $4)`,
      [this.session.id, this.session.startedAt, this.session.environment, this.session.transport]
    );

    // Matomo telemetry (fire-and-forget)
    matomo.sessionStart(transport, this.session.environment);
  }

  getSession(): SessionRecord | null {
    return this.session;
  }

  // --- User context (set by init tool) ---

  setUserContext(userName: string, purpose: string, telemetry: boolean, clientName?: string): void {
    if (!this.session) return;

    this.session.userName = userName;
    this.session.purpose = purpose;
    this.session.telemetry = telemetry;
    if (clientName) this.session.clientName = clientName;

    // Persist to DB (fire-and-forget)
    db.execute(
      `UPDATE sessions SET user_name = $1, user_purpose = $2, client_name = COALESCE($3, client_name) WHERE id = $4`,
      [userName, purpose, clientName || null, this.session.id]
    );

    // Matomo telemetry (fire-and-forget)
    matomo.initCalled(clientName || 'unknown', purpose);
  }

  // --- HTTP context (set from request headers) ---

  setHttpContext(userAgent: string, clientIp: string): void {
    if (!this.session) return;

    this.session.userAgent = userAgent;
    this.session.clientIp = clientIp;

    // Persist to DB (fire-and-forget)
    db.execute(
      `UPDATE sessions SET user_agent = $1, client_ip = $2 WHERE id = $3`,
      [userAgent || null, clientIp || null, this.session.id]
    );
  }

  // --- Auto-tracking (called from server.ts) ---

  recordToolCall(tool: string, args: Record<string, unknown>): number {
    if (!this.session) return 0;

    this.seq++;
    const ts = new Date().toISOString();
    const sanitized = sanitizeArgs(args);

    // JSONL (always)
    this.appendEventJsonl({
      sessionId: this.session.id,
      seq: this.seq,
      ts,
      type: 'tool_call',
      tool,
      args: sanitized,
    });

    // Postgres (fire-and-forget)
    db.execute(
      `INSERT INTO events (session_id, seq, ts, type, tool, args)
       VALUES ($1, $2, $3, 'tool_call', $4, $5)`,
      [this.session.id, this.seq, ts, tool, JSON.stringify(sanitized)]
    );

    this.session.toolCount++;
    this.session.toolSequence.push(tool);

    // Only count non-session tools for nudging
    if (!SESSION_TOOLS.has(tool)) {
      this.nudgeCounter++;
    }

    return this.seq;
  }

  recordToolResult(
    seq: number,
    tool: string,
    durationMs: number,
    isError: boolean,
    resultText: string,
    errorMessage?: string
  ): void {
    if (!this.session) return;

    const ts = new Date().toISOString();
    const summary = truncate(resultText, MAX_RESULT_SUMMARY_LEN) || undefined;

    // JSONL (always)
    this.appendEventJsonl({
      sessionId: this.session.id,
      seq,
      ts,
      type: 'tool_result',
      tool,
      durationMs,
      isError: isError || undefined,
      resultSummary: summary,
      errorMessage: errorMessage || undefined,
    });

    // Postgres (fire-and-forget)
    db.execute(
      `INSERT INTO events (session_id, seq, ts, type, tool, duration_ms, is_error, result_summary, error_message)
       VALUES ($1, $2, $3, 'tool_result', $4, $5, $6, $7, $8)`,
      [
        this.session.id,
        seq,
        ts,
        tool,
        durationMs,
        isError || null,
        summary || null,
        errorMessage || null,
      ]
    );

    if (isError) {
      this.session.errorCount++;
    }

    this.flushSession();
  }

  // --- Checkpointing ---

  recordMessages(messages: Array<{turn: number; role: string; content: unknown}>): void {
    if (!this.session) return;
    for (const msg of messages) {
      db.execute(
        `INSERT INTO messages (session_id, turn, role, content, ts)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (session_id, turn) DO UPDATE SET role=EXCLUDED.role, content=EXCLUDED.content, ts=EXCLUDED.ts`,
        [this.session.id, msg.turn, msg.role, JSON.stringify(msg.content)]
      );
    }
  }

  recordCheckpoint(summary: string, messages?: Array<{turn: number; role: string; content: unknown}>): {
    sessionId: string;
    seq: number;
    ts: string;
    summary: string;
    recentTools: string[];
  } {
    if (!this.session) {
      throw new Error('No active session');
    }

    this.seq++;
    const recentTools = this.session.toolSequence.slice(-MAX_RECENT_TOOLS);
    const ts = new Date().toISOString();

    // JSONL (always)
    this.appendEventJsonl({
      sessionId: this.session.id,
      seq: this.seq,
      ts,
      type: 'checkpoint',
      summary,
      recentTools,
    });

    // Postgres (fire-and-forget)
    db.execute(
      `INSERT INTO events (session_id, seq, ts, type, summary, recent_tools)
       VALUES ($1, $2, $3, 'checkpoint', $4, $5)`,
      [this.session.id, this.seq, ts, summary, recentTools]
    );

    if (messages && messages.length > 0) {
      this.recordMessages(messages);
    }

    this.session.checkpointCount++;
    this.session.lastCheckpointSummary = summary;
    this.resetNudgeCounter();
    this.flushSession();

    return {
      sessionId: this.session.id,
      seq: this.seq,
      ts,
      summary,
      recentTools,
    };
  }

  // --- Nudging ---

  shouldNudgeCheckpoint(): boolean {
    return this.nudgeCounter > 0 && this.nudgeCounter % NUDGE_INTERVAL === 0;
  }

  resetNudgeCounter(): void {
    this.nudgeCounter = 0;
  }

  // --- Private helpers ---

  private appendEventJsonl(event: Record<string, unknown>): void {
    if (!this.eventsStream) return;
    this.eventsStream.write(JSON.stringify(event) + '\n');
  }

  private flushSession(): void {
    if (!this.session) return;

    // JSONL (always)
    if (this.sessionsStream) {
      this.sessionsStream.write(JSON.stringify(this.session) + '\n');
    }

    // Postgres (fire-and-forget)
    db.execute(
      `UPDATE sessions SET
         tool_count = $2,
         checkpoint_count = $3,
         error_count = $4,
         tool_sequence = $5,
         last_checkpoint_summary = $6,
         updated_at = NOW()
       WHERE id = $1`,
      [
        this.session.id,
        this.session.toolCount,
        this.session.checkpointCount,
        this.session.errorCount,
        this.session.toolSequence,
        this.session.lastCheckpointSummary,
      ]
    );
  }
}

export const sessionStore = new SessionStore();
