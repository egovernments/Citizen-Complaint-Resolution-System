import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';
import * as path from 'path';
import Database from 'better-sqlite3';
import {
  BoundaryIndex,
  type BoundaryRow,
  type MatchMode,
} from './boundary-matcher';
import { intFromEnv } from './config';
import { RateLimiter } from './rate-limiter';

// Columns the name index reads; see buildIndex().
const INDEX_COLUMNS = [
  'id',
  'division_id',
  'name',
  'subtype',
  'class',
  'country',
  'admin_level',
  'parent_id',
];

interface TableColumn {
  name: string;
}

interface BboxRow {
  id: string;
  bbox: string | null;
}

/** Overture stores bbox as {xmin,xmax,ymin,ymax}; GeoJSON wants [west, south, east, north]. */
export function toGeoJsonBbox(
  raw: string | null | undefined,
): number[] | undefined {
  if (!raw) return undefined;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const nums = Array.isArray(v)
    ? v
    : v && typeof v === 'object'
      ? [
          (v as Record<string, unknown>).xmin,
          (v as Record<string, unknown>).ymin,
          (v as Record<string, unknown>).xmax,
          (v as Record<string, unknown>).ymax,
        ]
      : [];
  return nums.length === 4 &&
    nums.every((n): n is number => typeof n === 'number')
    ? nums
    : undefined;
}

@Injectable()
export class BoundaryService {
  private readonly logger = new Logger(BoundaryService.name);
  private db: any;
  // In-memory name index for source=overture search — see boundary-matcher.ts.
  private index: BoundaryIndex | null = null;
  // Outbound Geoapify calls per rolling minute, across all callers: the key's
  // quota is the project's, so the cap is global (GEOAPIFY_RATE_LIMIT; 0 = off).
  private readonly geoapifyLimiter = new RateLimiter(
    intFromEnv('GEOAPIFY_RATE_LIMIT', process.env.GEOAPIFY_RATE_LIMIT, 120),
  );
  // Largest subtree /boundary/fetch returns in one response (FETCH_MAX_FEATURES;
  // 0 = no cap). India's country row alone has ~62k areas under it — more than
  // a browser can draw or an operator can review.
  private readonly maxFetchFeatures = intFromEnv(
    'FETCH_MAX_FEATURES',
    process.env.FETCH_MAX_FEATURES,
    5000,
  );

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    try {
      // Initialize sqlite db connection.
      // Containerized deploys set OVERTURE_DB_PATH (docker-compose mounts the
      // generated DB at /overture-data/boundaries.sqlite). Local dev falls back
      // to the repo layout: search-api runs from turbopass/search-api, so the
      // DB produced by the bootstrap pipeline sits at ../overture-data.
      const dbPath = process.env.OVERTURE_DB_PATH
        ? path.resolve(process.env.OVERTURE_DB_PATH)
        : path.resolve(process.cwd(), '../overture-data/boundaries.sqlite');
      this.db = new Database(dbPath, { readonly: true });
      this.index = this.buildIndex();
    } catch (e) {
      console.warn(
        'Overture SQLite database not found or cannot be opened. Overture fallback will be disabled.',
        e,
      );
    }
  }

  // Names only (no geometry). Tolerates DBs that predate a pipeline step: a
  // column the table lacks (e.g. parent_id before build_hierarchy.py ran) is
  // read as NULL instead of failing the whole source.
  private buildIndex(): BoundaryIndex {
    const db = this.db as Database.Database;
    const info = db.prepare('PRAGMA table_info(boundaries)');
    const have = new Set((info.all() as TableColumn[]).map((c) => c.name));
    const cols = INDEX_COLUMNS.map((c) => (have.has(c) ? c : `NULL AS ${c}`));
    const started = Date.now();
    const select = db.prepare(`SELECT ${cols.join(', ')} FROM boundaries`);
    const index = new BoundaryIndex(select.all() as BoundaryRow[]);
    const ms = Date.now() - started;
    this.logger.log(`Overture name index: ${index.size} places in ${ms}ms`);
    return index;
  }

  // Search results carry no polygons — the configurator reads only their
  // properties, and /boundary/fetch serves geometry for the place picked.
  /** Which boundary sources this server can answer right now. */
  sources(): { overture: boolean; geoapify: boolean } {
    return {
      overture: !!this.index,
      geoapify: !!this.configService.get<string>('GEOAPIFY_API_KEY'),
    };
  }

  /** What the offline DB holds (the bootstrap's meta table), or null without one. */
  overtureInfo(): Record<string, string | number> | null {
    if (!this.db || !this.index) return null;
    const db = this.db as Database.Database;
    const hasMeta = db
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'",
      )
      .get();
    const meta = hasMeta
      ? (db.prepare('SELECT key, value FROM meta').all() as {
          key: string;
          value: string;
        }[])
      : [];
    return {
      places: this.index.size,
      ...Object.fromEntries(meta.map((m) => [m.key, m.value])),
    };
  }

  private takeGeoapify(): void {
    const wait = this.geoapifyLimiter.tryTake();
    if (wait > 0) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: `Geoapify call limit reached on this server; retry in ${wait}s.`,
          retryAfter: wait,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private loadBboxes(ids: string[]): Map<string, BboxRow> {
    const db = this.db as Database.Database;
    const placeholders = ids.map(() => '?').join(', ');
    const sql = `SELECT id, bbox FROM boundaries WHERE id IN (${placeholders})`;
    const rows = db.prepare(sql).all(...ids) as BboxRow[];
    return new Map(rows.map((r) => [r.id, r]));
  }

  // `match` and `limit` shape the overture search only; geoapify ignores them.
  async search(
    query: string,
    source: string,
    match: MatchMode = 'substring',
    limit = 10,
    minDescendants = 0,
  ): Promise<any> {
    if (source === 'geoapify') {
      const apiKey = this.configService.get<string>('GEOAPIFY_API_KEY');
      if (!apiKey) {
        throw new HttpException(
          'GEOAPIFY_API_KEY config is missing',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
      this.takeGeoapify();
      const url = `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(
        query,
      )}&type=city&apiKey=${apiKey}`;

      try {
        const response$ = this.httpService.get(url);
        const response = await lastValueFrom(response$);
        return response.data;
      } catch (error: any) {
        throw new HttpException(
          error.response?.data?.message || 'Geoapify search request failed',
          error.response?.status || HttpStatus.BAD_GATEWAY,
        );
      }
    } else if (source === 'overture') {
      if (!this.db || !this.index) {
        throw new HttpException(
          'Overture database is not available locally.',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      try {
        const hits = this.index.search(query, match, limit, minDescendants);
        if (hits.length === 0) {
          return { type: 'FeatureCollection', features: [] };
        }
        const boxes = this.loadBboxes(hits.map((h) => h.id));

        return {
          type: 'FeatureCollection',
          features: hits.map((h) => {
            const b = boxes.get(h.id);
            return {
              type: 'Feature',
              properties: {
                place_id: h.id,
                formatted: h.formatted,
                name: h.name,
                country_code: h.country,
                country_name: h.country_name,
                category: 'administrative',
                city: h.name,
                admin_level: h.admin_level,
                subtype: h.subtype,
                parent_name: h.parent_name,
                region_name: h.region_name,
                descendant_count: h.descendant_count,
                match_type: h.match_type,
                score: h.score,
              },
              bbox: toGeoJsonBbox(b?.bbox),
              geometry: null,
            };
          }),
        };
      } catch (error: any) {
        throw new HttpException(
          error.message,
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    } else {
      throw new HttpException(
        `Source '${source}' is not supported yet`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  async fetchBoundaries(id: string, source: string): Promise<any> {
    if (source === 'geoapify') {
      const apiKey = this.configService.get<string>('GEOAPIFY_API_KEY');
      if (!apiKey) {
        throw new HttpException(
          'GEOAPIFY_API_KEY config is missing',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      const allFeatures: any[] = [];

      this.takeGeoapify();
      try {
        const placeUrl = `https://api.geoapify.com/v2/place-details?id=${encodeURIComponent(id)}&features=details,geometry&apiKey=${apiKey}`;
        const placeRes$ = this.httpService.get(placeUrl);
        const placeRes = await lastValueFrom(placeRes$);
        const rootFeatures = placeRes.data?.features || [];
        allFeatures.push(...rootFeatures);
      } catch (error: any) {
        console.warn(
          `Failed to fetch root place details for ${id}:`,
          error.message,
        );
      }

      for (let sublevel = 1; sublevel <= 5; sublevel++) {
        this.takeGeoapify();
        const url = `https://api.geoapify.com/v1/boundaries/consists-of?id=${encodeURIComponent(
          id,
        )}&geometry=geometry_1000&sublevel=${sublevel}&apiKey=${apiKey}`;

        try {
          const response$ = this.httpService.get(url);
          const response = await lastValueFrom(response$);
          const features = response.data?.features || [];

          if (features.length === 0) break;
          allFeatures.push(...features);
        } catch (error: any) {
          console.warn(
            `Failed to fetch sublevel ${sublevel} for ${id}:`,
            error.message,
          );
          break;
        }
      }

      return {
        type: 'FeatureCollection',
        features: allFeatures,
      };
    } else if (source === 'overture') {
      if (!this.db) {
        throw new HttpException(
          'Overture database is not available locally.',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }

      const total = 1 + (this.index?.descendantsOf(id) ?? 0);
      if (this.maxFetchFeatures > 0 && total > this.maxFetchFeatures) {
        throw new HttpException(
          `"${this.index?.nameOf(id) ?? id}" has ${total - 1} areas under it — more than this server returns in one fetch (${this.maxFetchFeatures}). Pick a smaller area inside it.`,
          HttpStatus.PAYLOAD_TOO_LARGE,
        );
      }

      try {
        // Recursive CTE to fetch the root boundary and all its descendants
        const stmt = this.db.prepare(`
          WITH RECURSIVE children(id) AS (
              SELECT id FROM boundaries WHERE id = ?
              UNION ALL
              SELECT b.id FROM boundaries b
              JOIN children c ON b.parent_id = c.id
          )
          SELECT b.id, b.name, b.country, b.subtype, b.admin_level, b.geometry 
          FROM boundaries b
          WHERE b.id IN children
        `);
        const rows = stmt.all(id);

        return {
          type: 'FeatureCollection',
          features: rows.map((r: any) => ({
            type: 'Feature',
            properties: {
              place_id: r.id,
              name: r.name,
              formatted: `${r.name}, ${r.country}`,
              admin_level: r.admin_level || 0,
              subtype: r.subtype,
            },
            geometry: JSON.parse(r.geometry || '{}'),
          })),
        };
      } catch (error: any) {
        throw new HttpException(
          error.message,
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    } else {
      throw new HttpException(
        `Source '${source}' is not supported yet`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}
