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

  /**
   * A seeded leaf of the tenant's ADMIN boundary tree. PGR's create checks the
   * complaint locality against boundary-service, so a made-up code such as
   * LOC_CITYA_1 is refused with INVALID_BOUNDARY_CODE.
   */
  async leafBoundaryCode(tenantId: string): Promise<string> {
    const code = await this.queryValue<string>(
      `SELECT r.code FROM boundary_relationship r
         JOIN boundary b ON b.tenantid = r.tenantid AND b.code = r.code
        WHERE r.tenantid = $1 AND r.hierarchytype = 'ADMIN'
          AND NOT EXISTS (SELECT 1 FROM boundary_relationship c
                           WHERE c.tenantid = r.tenantid AND c.hierarchytype = r.hierarchytype AND c.parent = r.code)
        ORDER BY r.code LIMIT 1`,
      [tenantId]
    );
    if (!code) throw new Error(`No ADMIN boundary seeded for ${tenantId}`);
    return code;
  }

  /**
   * Root of a tenant's ADMIN boundary tree, for an employee's HRMS jurisdiction.
   * PGR search scopes an employee to the descendants of their jurisdiction
   * boundaries, so the root covers every leaf a smoke-test complaint is filed at.
   * The tenant id itself (e.g. 'pg.citya') is not a boundary code and matches nothing.
   */
  async rootBoundary(tenantId: string): Promise<{ code: string; boundaryType: string }> {
    const row = await this.queryOne<{ code: string; boundarytype: string }>(
      `SELECT code, boundarytype FROM boundary_relationship
        WHERE tenantid = $1 AND hierarchytype = 'ADMIN' AND parent IS NULL
        ORDER BY code LIMIT 1`,
      [tenantId]
    );
    if (!row) throw new Error(`No ADMIN boundary root seeded for ${tenantId}`);
    return { code: row.code, boundaryType: row.boundarytype };
  }
}

export const db = new DatabaseClient();
