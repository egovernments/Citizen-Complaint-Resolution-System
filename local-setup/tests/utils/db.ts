import { Pool, QueryResult, QueryResultRow } from 'pg';
import { config } from './config';

class DatabaseClient {
  private pool: Pool | null = null;

  connect(): void {
    if (this.pool) return;

    this.pool = new Pool({
      host: config.db.host,
      port: config.db.port,
      database: config.db.database,
      user: config.db.user,
      password: config.db.password,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }

  async query<T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
    if (!this.pool) {
      this.connect();
    }
    return this.pool!.query<T>(sql, params);
  }

  async queryOne<T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<T | null> {
    const result = await this.query<T>(sql, params);
    return result.rows[0] || null;
  }

  async queryValue<T = unknown>(sql: string, params?: unknown[]): Promise<T | null> {
    const result = await this.query(sql, params);
    if (result.rows.length === 0) return null;
    const firstRow = result.rows[0] as Record<string, T>;
    const keys = Object.keys(firstRow);
    return keys.length > 0 ? firstRow[keys[0]] : null;
  }

  async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  // Helper methods for common queries
  async userExistsByUuid(uuid: string): Promise<boolean> {
    const result = await this.queryValue<string>(
      'SELECT uuid FROM eg_user WHERE uuid = $1',
      [uuid]
    );
    return result === uuid;
  }

  async getSequenceValue(seqName: string): Promise<number> {
    const result = await this.queryValue<string>(
      `SELECT last_value FROM ${seqName}`
    );
    return parseInt(result || '0', 10);
  }

  async tableExists(tableName: string): Promise<boolean> {
    const result = await this.queryValue<number>(
      `SELECT COUNT(*) FROM information_schema.tables WHERE table_name = $1`,
      [tableName]
    );
    return (result || 0) > 0;
  }

  async getRowCount(tableName: string): Promise<number> {
    const result = await this.queryValue<string>(`SELECT COUNT(*) FROM ${tableName}`);
    return parseInt(result || '0', 10);
  }
}

export const db = new DatabaseClient();
