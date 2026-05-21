/**
 * Engram Agent — Async Session-to-Knowledge Pipeline
 *
 * Reads raw session data (tool calls, errors, checkpoints) from PostgreSQL,
 * synthesizes patterns using Claude, and writes distilled knowledge ("engrams")
 * to living markdown documents that feed back into the MCP server's docs_search.
 *
 * Follows the engram spec's 4-document architecture:
 *   - API Registry:      DIGIT API behaviors, parameters, quirks
 *   - Claim Registry:    Epistemic claims about API behavior
 *   - Workflow Registry:  Tool call sequences, success/failure patterns
 *   - Session Digest:    Chronological summary of recent activity
 *   - Two graveyard files for superseded/refuted entries (append-only)
 *
 * Designed to run daily via PM2 cron. Uses Claude Agent SDK for synthesis.
 */

import pg from 'pg';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const { Pool } = pg;

// ---------------------------------------------------------------------------
// Section 1: Constants + config
// ---------------------------------------------------------------------------

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ENGRAMS_DIR = resolve(__dirname, 'data', 'engrams');
const DOCS_DIR = resolve(__dirname, 'docs');
const LOOKBACK_HOURS = 25;
const MODEL = process.env.ENGRAM_MODEL ?? 'claude-opus-4-6';

/** Context files to feed the fold agent so it understands the MCP server and DIGIT platform. */
const CONTEXT_FILES = [
  'guides/api-nuances.md',
  'guides/pgr-lifecycle.md',
  'architecture.md',
] as const;

const LIVING_DOC_FILES = [
  'api_registry.md',
  'claim_registry.md',
  'workflow_registry.md',
  'session_digest.md',
  'api_graveyard.md',
  'claim_graveyard.md',
] as const;

type LivingDocFile = (typeof LIVING_DOC_FILES)[number];

// ---------------------------------------------------------------------------
// Section 2: DB helpers
// ---------------------------------------------------------------------------

function getPool(): InstanceType<typeof Pool> {
  const connectionString = process.env.SESSION_DB_URL;
  const config = connectionString
    ? { connectionString }
    : {
        host: process.env.SESSION_DB_HOST || 'localhost',
        port: parseInt(process.env.SESSION_DB_PORT || '15433', 10),
        database: process.env.SESSION_DB_NAME || 'mcp_sessions',
        user: process.env.SESSION_DB_USER || 'mcp',
        password: process.env.SESSION_DB_PASSWORD || 'mcp123',
      };

  return new Pool({ ...config, max: 3, idleTimeoutMillis: 10_000 });
}

interface TimeWindow {
  start: Date;
  end: Date;
}

async function getTimeWindow(pool: InstanceType<typeof Pool>): Promise<TimeWindow> {
  const end = new Date();

  // Look for last successful run
  const result = await pool.query<{ window_end: Date }>(
    `SELECT window_end FROM engram_runs
     WHERE status = 'success'
     ORDER BY run_at DESC LIMIT 1`
  );

  const start =
    result.rows.length > 0
      ? result.rows[0].window_end
      : new Date(end.getTime() - LOOKBACK_HOURS * 60 * 60 * 1000);

  return { start, end };
}

interface AllocatedIds {
  A: number[];
  C: number[];
  W: number[];
}

async function getNextIds(
  pool: InstanceType<typeof Pool>,
  counts: { A: number; C: number; W: number }
): Promise<AllocatedIds> {
  const result: AllocatedIds = { A: [], C: [], W: [] };

  for (const category of ['A', 'C', 'W'] as const) {
    const count = counts[category];
    if (count <= 0) continue;

    const row = await pool.query<{ next_id: number }>(
      `UPDATE engram_id_counters
       SET next_id = next_id + $1
       WHERE category = $2
       RETURNING next_id - $1 AS next_id`,
      [count, category]
    );

    const startId = row.rows[0].next_id;
    for (let i = 0; i < count; i++) {
      result[category].push(startId + i);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Section 3: Session data loader
// ---------------------------------------------------------------------------

interface SessionRow {
  id: string;
  started_at: Date;
  environment: string;
  transport: string;
  tool_count: number;
  error_count: number;
  checkpoint_count: number;
  tool_sequence: string[];
  last_checkpoint_summary: string;
  user_name: string | null;
  user_purpose: string | null;
  client_name: string | null;
}

interface EventRow {
  seq: number;
  ts: Date;
  type: string;
  tool: string | null;
  args: Record<string, unknown> | null;
  duration_ms: number | null;
  is_error: boolean | null;
  result_summary: string | null;
  error_message: string | null;
  summary: string | null;
}

interface SessionSummary {
  id: string;
  clientName: string | null;
  userName: string | null;
  purpose: string | null;
  transport: string;
  toolCount: number;
  errorCount: number;
  toolSequence: string[];
  errors: Array<{ tool: string; errorMessage: string; seq: number; args?: Record<string, unknown> }>;
  checkpoints: string[];
  durationMinutes: number;
  /** Tool calls that preceded errors, showing what the agent was trying to do. */
  errorContext: Array<{ tool: string; args: Record<string, unknown>; errorMessage: string; resultSummary?: string }>;
}

async function loadSessions(
  pool: InstanceType<typeof Pool>,
  start: Date,
  end: Date
): Promise<SessionRow[]> {
  const result = await pool.query<SessionRow>(
    `SELECT id, started_at, environment, transport, tool_count, error_count,
            checkpoint_count, tool_sequence, last_checkpoint_summary,
            user_name, user_purpose, client_name
     FROM sessions
     WHERE started_at >= $1 AND started_at < $2
     ORDER BY started_at ASC`,
    [start.toISOString(), end.toISOString()]
  );
  return result.rows;
}

async function loadSessionEvents(
  pool: InstanceType<typeof Pool>,
  sessionId: string
): Promise<EventRow[]> {
  const result = await pool.query<EventRow>(
    `SELECT seq, ts, type, tool, args, duration_ms, is_error,
            result_summary, error_message, summary
     FROM events
     WHERE session_id = $1
     ORDER BY seq ASC`,
    [sessionId]
  );
  return result.rows;
}

function buildSessionSummary(session: SessionRow, events: EventRow[]): SessionSummary {
  const errors = events
    .filter((e) => e.is_error === true && e.error_message)
    .map((e) => ({
      tool: e.tool || 'unknown',
      errorMessage: e.error_message!,
      seq: e.seq,
      args: e.args || undefined,
    }));

  // Build richer error context: include the tool_call args that caused each error
  const errorContext = events
    .filter((e) => e.type === 'tool_result' && e.is_error === true)
    .map((e) => {
      // Find the matching tool_call event (same tool, preceding seq)
      const callEvent = events.find(
        (c) => c.type === 'tool_call' && c.tool === e.tool && c.seq < e.seq
      );
      return {
        tool: e.tool || 'unknown',
        args: callEvent?.args || {},
        errorMessage: e.error_message || e.result_summary || 'unknown error',
        resultSummary: e.result_summary || undefined,
      };
    });

  const checkpoints = events
    .filter((e) => e.type === 'checkpoint' && e.summary)
    .map((e) => e.summary!);

  // Estimate duration from first to last event
  const timestamps = events.map((e) => new Date(e.ts).getTime()).filter((t) => !isNaN(t));
  const durationMinutes =
    timestamps.length >= 2
      ? Math.round((Math.max(...timestamps) - Math.min(...timestamps)) / 60_000)
      : 0;

  return {
    id: session.id.substring(0, 8),
    clientName: session.client_name,
    userName: session.user_name,
    purpose: session.user_purpose,
    transport: session.transport,
    toolCount: session.tool_count,
    errorCount: session.error_count,
    toolSequence: session.tool_sequence || [],
    errors,
    checkpoints,
    durationMinutes,
    errorContext,
  };
}

// ---------------------------------------------------------------------------
// Section 4: Prompt builder
// ---------------------------------------------------------------------------

async function readLivingDocs(): Promise<Record<LivingDocFile, string>> {
  const docs = {} as Record<LivingDocFile, string>;

  await mkdir(ENGRAMS_DIR, { recursive: true });

  for (const file of LIVING_DOC_FILES) {
    try {
      docs[file] = await readFile(join(ENGRAMS_DIR, file), 'utf-8');
    } catch {
      docs[file] = '';
    }
  }

  return docs;
}

/**
 * Load MCP context: api-nuances, architecture, pgr-lifecycle, plus a condensed
 * tool catalog (name + first line of each tool doc).
 */
async function loadMcpContext(): Promise<string> {
  const sections: string[] = [];

  // Load full context files
  for (const file of CONTEXT_FILES) {
    try {
      const content = await readFile(join(DOCS_DIR, file), 'utf-8');
      sections.push(content);
    } catch {
      // File missing — skip
    }
  }

  // Build condensed tool catalog from docs/api/tools/
  try {
    const toolDir = join(DOCS_DIR, 'api', 'tools');
    const toolFiles = await readdir(toolDir);
    const toolLines: string[] = ['## MCP Tool Catalog (59 tools)', ''];
    for (const file of toolFiles.sort()) {
      if (!file.endsWith('.md')) continue;
      try {
        const content = await readFile(join(toolDir, file), 'utf-8');
        const titleMatch = content.match(/^#\s+(.+)/m);
        const descMatch = content.match(/^>\s*(.+)/m) || content.match(/\n\n(.+)/);
        const name = file.replace('.md', '');
        const desc = descMatch ? descMatch[1].slice(0, 120) : titleMatch?.[1] || '';
        toolLines.push(`- **${name}**: ${desc}`);
      } catch { /* skip */ }
    }
    sections.push(toolLines.join('\n'));
  } catch { /* no tool docs */ }

  return sections.join('\n\n---\n\n');
}

function buildFoldPrompt(
  summaries: SessionSummary[],
  livingDocs: Record<LivingDocFile, string>,
  allocatedIds: AllocatedIds,
  mcpContext: string
): string {
  const startDate = summaries.length > 0 ? summaries[0].id : 'N/A';
  const endDate = summaries.length > 0 ? summaries[summaries.length - 1].id : 'N/A';

  const idSection = [
    allocatedIds.A.length > 0
      ? `- API registry: ${allocatedIds.A.map((n) => `A${String(n).padStart(3, '0')}`).join(', ')}`
      : null,
    allocatedIds.C.length > 0
      ? `- Claim registry: ${allocatedIds.C.map((n) => `C${String(n).padStart(3, '0')}`).join(', ')}`
      : null,
    allocatedIds.W.length > 0
      ? `- Workflow registry: ${allocatedIds.W.map((n) => `W${String(n).padStart(3, '0')}`).join(', ')}`
      : null,
  ]
    .filter(Boolean)
    .join('\n');

  return `You are the DIGIT MCP engram fold agent. You analyze MCP session data to find
issues, friction points, and improvement opportunities for the DIGIT MCP server.

Your goal is NOT to document what happened — it's to surface actionable insights that
help the MCP maintainer improve the server. Think like a product analyst looking at
usage telemetry, not a chronicler.

## MCP Server Context

This is the DIGIT MCP server — an MCP server exposing 59 tools for the DIGIT eGov platform.
Below is background on the architecture, known API quirks, PGR workflow, and tool catalog.
Use this to distinguish between known issues (already in api-nuances.md) and NEW discoveries.

${mcpContext}

## Current Living Documents

### api_registry.md
\`\`\`
${livingDocs['api_registry.md']}
\`\`\`

### claim_registry.md
\`\`\`
${livingDocs['claim_registry.md']}
\`\`\`

### workflow_registry.md
\`\`\`
${livingDocs['workflow_registry.md']}
\`\`\`

### session_digest.md
\`\`\`
${livingDocs['session_digest.md']}
\`\`\`

### api_graveyard.md
\`\`\`
${livingDocs['api_graveyard.md']}
\`\`\`

### claim_graveyard.md
\`\`\`
${livingDocs['claim_graveyard.md']}
\`\`\`

## New Session Data (${summaries.length} sessions, ${startDate} to ${endDate})

${JSON.stringify(summaries, null, 2)}

## Pre-assigned IDs
${idSection || '(No new IDs allocated — only update existing entries if needed)'}

## What to Look For

Analyze the session data with a DIAGNOSTIC mindset. Prioritize:

### 1. Failures & Errors (api_registry.md)
- Which tools failed? What error messages did agents see?
- Are there parameter combinations that consistently break?
- Are error messages misleading or unhelpful? What should they say instead?
- New API quirks NOT already in the api-nuances.md context above?
- **MCP improvement suggestion**: What should the server change to prevent this?

### 2. Friction & Confusion (claim_registry.md)
- Where did agents retry, backtrack, or take unnecessary steps?
- Are there tools that agents call but shouldn't need to (missing automation)?
- Cross-tenant issues — did agents struggle with tenant switching?
- Are tool descriptions or parameter names confusing based on usage patterns?
- Claims should be ACTIONABLE: "The MCP server should do X because Y"

### 3. Workflow Anti-patterns (workflow_registry.md)
- Sequences that work but are unnecessarily long — what could be collapsed?
- Common failure recovery paths — what went wrong and how did agents recover?
- Missing "happy path" shortcuts the MCP server could provide?
- Tool ordering dependencies the server could enforce or auto-resolve?

### 4. Activity Summary (session_digest.md)
- Concise dated paragraph per batch
- Highlight: error rate, most-failed tools, client breakdown, notable incidents
- Keep last 10 entries; collapse older to single lines

### 5. Quality Bar
- Do NOT create entries for obvious/trivial observations ("tool X was called N times")
- Every entry MUST have either an error to fix, a friction point to smooth, or a concrete improvement to make
- If sessions are clean with no issues, say so in the digest and skip the other files
- Don't duplicate information already in the api-nuances.md context

## Output Format

For each file that needs updating, output its complete new content:

\`\`\`file:api_registry.md
[complete updated content]
\`\`\`

Rules:
- Use ONLY pre-assigned IDs for new entries; never invent IDs
- Keep entries concise (max 5 lines per entry body)
- Every entry MUST have "MCP improvement:" (1 sentence — what should the server change)
- Move CHANGED/refuted entries to graveyard (stub in living doc + full entry in graveyard)
- Tag client-specific observations: [Client: X]
- If no changes needed for a file, do NOT output a block for it
- Only output file blocks — no preamble, no explanation outside the blocks`;
}

// ---------------------------------------------------------------------------
// Section 5: Claude synthesis
// ---------------------------------------------------------------------------

interface FileUpdate {
  filename: LivingDocFile;
  content: string;
}

async function synthesize(prompt: string): Promise<FileUpdate[]> {
  const messages: Array<{ type: string; [key: string]: unknown }> = [];

  // Strip CLAUDECODE env var to avoid subprocess detection
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.CLAUDECODE;

  for await (const message of query({
    prompt,
    options: {
      model: MODEL,
      maxTurns: 1,
      tools: [],
      persistSession: false,
      env,
    },
  })) {
    messages.push(message as { type: string; [key: string]: unknown });
  }

  return parseUpdatedFiles(messages);
}

function parseUpdatedFiles(messages: Array<{ type: string; [key: string]: unknown }>): FileUpdate[] {
  const updates: FileUpdate[] = [];
  const fileBlockRegex = /```file:(\S+)\n([\s\S]*?)```/g;

  for (const message of messages) {
    if (message.type === 'assistant') {
      const msg = message as Record<string, unknown>;
      const content = msg.message as { content: Array<Record<string, unknown>> } | undefined;
      if (content?.content) {
        for (const block of content.content) {
          if (block.type === 'text') {
            const text = block.text as string;
            let match: RegExpExecArray | null;
            while ((match = fileBlockRegex.exec(text)) !== null) {
              const filename = match[1] as LivingDocFile;
              if (LIVING_DOC_FILES.includes(filename)) {
                updates.push({ filename, content: match[2].trim() + '\n' });
              }
            }
          }
        }
      }
    }

    // Also check result text
    if (message.type === 'result') {
      const result = message.result as string | undefined;
      if (result) {
        let match: RegExpExecArray | null;
        while ((match = fileBlockRegex.exec(result)) !== null) {
          const filename = match[1] as LivingDocFile;
          if (LIVING_DOC_FILES.includes(filename)) {
            updates.push({ filename, content: match[2].trim() + '\n' });
          }
        }
      }
    }
  }

  return updates;
}

// ---------------------------------------------------------------------------
// Section 6: File writer
// ---------------------------------------------------------------------------

async function writeEngrams(updates: FileUpdate[]): Promise<string[]> {
  const written: string[] = [];

  await mkdir(ENGRAMS_DIR, { recursive: true });

  for (const { filename, content } of updates) {
    const filePath = join(ENGRAMS_DIR, filename);
    await writeFile(filePath, content, 'utf-8');
    written.push(filename);
  }

  return written;
}

// ---------------------------------------------------------------------------
// Section 7: Main runner
// ---------------------------------------------------------------------------

async function recordRun(
  pool: InstanceType<typeof Pool>,
  sessionsProcessed: number,
  status: 'success' | 'partial' | 'failed',
  window: TimeWindow,
  errorMessage?: string
): Promise<void> {
  await pool.query(
    `INSERT INTO engram_runs (sessions_processed, status, window_start, window_end, error_message)
     VALUES ($1, $2, $3, $4, $5)`,
    [sessionsProcessed, status, window.start.toISOString(), window.end.toISOString(), errorMessage || null]
  );
}

async function main(): Promise<void> {
  console.log('[engram] Starting engram agent run...');
  const pool = getPool();

  try {
    // Ensure tables exist (in case this runs before the MCP server)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS engram_runs (
        id                 SERIAL PRIMARY KEY,
        run_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        sessions_processed INTEGER NOT NULL DEFAULT 0,
        status             TEXT NOT NULL CHECK (status IN ('success', 'partial', 'failed')),
        error_message      TEXT,
        window_start       TIMESTAMPTZ NOT NULL,
        window_end         TIMESTAMPTZ NOT NULL
      );
      CREATE TABLE IF NOT EXISTS engram_id_counters (
        category TEXT PRIMARY KEY,
        next_id  INTEGER NOT NULL DEFAULT 1
      );
      INSERT INTO engram_id_counters (category, next_id)
        VALUES ('A', 1), ('C', 1), ('W', 1)
        ON CONFLICT DO NOTHING;
    `);

    // Get time window
    const window = await getTimeWindow(pool);
    console.log(
      `[engram] Time window: ${window.start.toISOString()} → ${window.end.toISOString()}`
    );

    // Load sessions
    const sessions = await loadSessions(pool, window.start, window.end);
    console.log(`[engram] Found ${sessions.length} sessions in window`);

    if (sessions.length === 0) {
      console.log('[engram] No sessions to process, recording empty run.');
      await recordRun(pool, 0, 'success', window);
      return;
    }

    // Build summaries
    const summaries: SessionSummary[] = [];
    for (const session of sessions) {
      const events = await loadSessionEvents(pool, session.id);
      summaries.push(buildSessionSummary(session, events));
    }

    // Read current living docs and MCP context in parallel
    const [livingDocs, mcpContext] = await Promise.all([
      readLivingDocs(),
      loadMcpContext(),
    ]);
    console.log(`[engram] MCP context loaded: ${mcpContext.length} chars`);

    // Estimate new entries needed (heuristic: 1 per 3 sessions, min 3 per category)
    const estimatedNew = Math.max(3, Math.ceil(summaries.length / 3));
    const allocatedIds = await getNextIds(pool, {
      A: estimatedNew,
      C: estimatedNew,
      W: estimatedNew,
    });

    console.log(
      `[engram] Allocated IDs — A: ${allocatedIds.A.length}, C: ${allocatedIds.C.length}, W: ${allocatedIds.W.length}`
    );

    // Build fold prompt
    const prompt = buildFoldPrompt(summaries, livingDocs, allocatedIds, mcpContext);
    console.log(`[engram] Prompt length: ${prompt.length} chars`);

    // Synthesize with Claude
    console.log(`[engram] Calling Claude (${MODEL})...`);
    const updates = await synthesize(prompt);
    console.log(`[engram] Claude returned ${updates.length} file updates`);

    if (updates.length === 0) {
      console.log('[engram] No file updates produced, recording partial run.');
      await recordRun(pool, summaries.length, 'partial', window, 'No file updates from synthesis');
      return;
    }

    // Write updated engram files
    const written = await writeEngrams(updates);
    console.log(`[engram] Wrote files: ${written.join(', ')}`);

    // Record successful run
    await recordRun(pool, summaries.length, 'success', window);
    console.log(
      `[engram] Run complete. Processed ${summaries.length} sessions, updated ${written.length} files.`
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[engram] Run failed: ${errorMessage}`);

    try {
      const window = await getTimeWindow(pool);
      await recordRun(pool, 0, 'failed', window, errorMessage);
    } catch {
      console.error('[engram] Failed to record error run in DB');
    }

    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
