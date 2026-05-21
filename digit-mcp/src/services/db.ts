import pg from 'pg';

const { Pool } = pg;
type PgPool = InstanceType<typeof Pool>;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  id                      UUID PRIMARY KEY,
  started_at              TIMESTAMPTZ NOT NULL,
  environment             TEXT NOT NULL DEFAULT '',
  transport               TEXT NOT NULL CHECK (transport IN ('stdio', 'http')),
  tool_count              INTEGER NOT NULL DEFAULT 0,
  checkpoint_count        INTEGER NOT NULL DEFAULT 0,
  error_count             INTEGER NOT NULL DEFAULT 0,
  tool_sequence           TEXT[] NOT NULL DEFAULT '{}',
  last_checkpoint_summary TEXT NOT NULL DEFAULT '',
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS events (
  session_id     UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  seq            INTEGER NOT NULL,
  ts             TIMESTAMPTZ NOT NULL,
  type           TEXT NOT NULL CHECK (type IN ('tool_call', 'tool_result', 'checkpoint')),
  tool           TEXT,
  args           JSONB,
  duration_ms    INTEGER,
  is_error       BOOLEAN,
  result_summary TEXT,
  error_message  TEXT,
  summary        TEXT,
  recent_tools   TEXT[],
  PRIMARY KEY (session_id, seq, type)
);

CREATE TABLE IF NOT EXISTS messages (
  session_id  UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  turn        INTEGER NOT NULL,
  role        TEXT NOT NULL,
  content     JSONB NOT NULL,
  ts          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (session_id, turn)
);

CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_tool ON events(tool);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts DESC);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, turn);

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_name TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_purpose TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS client_name TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS client_ip TEXT;

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
`;

class Db {
  private pool: PgPool | null = null;
  private healthy = false;

  async initialize(): Promise<void> {
    if (this.pool) return;

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

    this.pool = new Pool({ ...config, max: 5, idleTimeoutMillis: 30_000 });

    try {
      const client = await this.pool.connect();
      try {
        await client.query(SCHEMA_SQL);
      } finally {
        client.release();
      }
      this.healthy = true;
    } catch (err) {
      console.error(`[session-db] Failed to connect to PostgreSQL: ${err instanceof Error ? err.message : err}`);
      console.error('[session-db] Sessions will NOT be persisted this run.');
      // Tear down the pool so execute/query know DB is unavailable
      await this.pool.end().catch(() => {});
      this.pool = null;
      this.healthy = false;
    }
  }

  /** Fire-and-forget write — catches errors, logs warning, never throws. */
  execute(sql: string, params: unknown[] = []): void {
    if (!this.pool) return;
    this.pool.query(sql, params).catch((err) => {
      console.error(`[session-db] Write failed: ${err instanceof Error ? err.message : err}`);
    });
  }

  /** Read query — throws on failure so caller can handle. */
  async query<T extends pg.QueryResultRow = Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
  ): Promise<T[]> {
    if (!this.pool) throw new Error('Database not available');
    const result = await this.pool.query<T>(sql, params);
    return result.rows;
  }

  isHealthy(): boolean {
    return this.healthy;
  }
}

export const db = new Db();
