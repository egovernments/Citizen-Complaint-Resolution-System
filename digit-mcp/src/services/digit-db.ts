import pg from 'pg';

const { Pool } = pg;
type PgPool = InstanceType<typeof Pool>;

/**
 * Read-only Postgres pool for the DIGIT `egov` database.
 * Follows the same pattern as db.ts (session DB) but connects to the
 * main DIGIT database where PGR tables and materialized views live.
 */
class DigitDb {
  private pool: PgPool | null = null;
  private healthy = false;

  async initialize(): Promise<void> {
    if (this.pool) return;

    const connectionString = process.env.DIGIT_DB_URL;
    const config = connectionString
      ? { connectionString }
      : {
          host: process.env.DIGIT_DB_HOST || 'docker-postgres',
          port: parseInt(process.env.DIGIT_DB_PORT || '5432', 10),
          database: process.env.DIGIT_DB_NAME || 'egov',
          user: process.env.DIGIT_DB_USER || 'egov',
          password: process.env.DIGIT_DB_PASSWORD || 'egov123',
        };

    this.pool = new Pool({ ...config, max: 3, idleTimeoutMillis: 30_000 });

    try {
      const client = await this.pool.connect();
      try {
        await client.query('SELECT 1');
      } finally {
        client.release();
      }
      this.healthy = true;
      console.error('[digit-db] Connected to DIGIT egov database');
    } catch (err) {
      console.error(`[digit-db] Failed to connect: ${err instanceof Error ? err.message : err}`);
      console.error('[digit-db] Dashboard endpoint will return 503.');
      await this.pool.end().catch(() => {});
      this.pool = null;
      this.healthy = false;
    }
  }

  /** Read query — throws on failure so caller can handle. */
  async query<T extends pg.QueryResultRow = Record<string, unknown>>(
    sql: string,
    params: unknown[] = []
  ): Promise<T[]> {
    if (!this.pool) throw new Error('DIGIT database not available');
    const result = await this.pool.query<T>(sql, params);
    return result.rows;
  }

  isHealthy(): boolean {
    return this.healthy;
  }
}

export const digitDb = new DigitDb();
