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
import { levelNameFor } from './level-names';
import {
  geoapifyFetchFeatures,
  geoapifySearchFeatures,
  withDepths,
} from './normalize';
import { RateLimiter } from './rate-limiter';

// Columns the name indexes read; see buildIndexes().
const INDEX_COLUMNS = [
  'id',
  'division_id',
  'name',
  'subtype',
  'class',
  'country',
  'admin_level',
  'parent_id',
  'source',
  'licence',
  'official',
];

/**
 * Sources served from the offline DB. `overture` is the Overture Maps build;
 * `cod` (OCHA COD-AB) and `geoboundaries` are the government-derived sets that
 * official.py adds; `official` is, per country, whichever of those two nests
 * deepest (#1994).
 */
export const OFFLINE_SOURCES = [
  'overture',
  'official',
  'cod',
  'geoboundaries',
] as const;
export type OfflineSource = (typeof OFFLINE_SOURCES)[number];

export function isOfflineSource(v: string): v is OfflineSource {
  return (OFFLINE_SOURCES as readonly string[]).includes(v);
}

interface IndexRow extends BoundaryRow {
  official: number | null;
}

/** Which offline index a row belongs to; `official` rows also sit in their own source's. */
export function offlineSourcesOf(row: IndexRow): OfflineSource[] {
  const own: OfflineSource =
    row.source === 'cod' || row.source === 'geoboundaries'
      ? row.source
      : 'overture';
  return row.official === 1 ? [own, 'official'] : [own];
}

// A Geoapify fetch: place details, then one boundaries call per sublevel.
const GEOAPIFY_SUBLEVELS = 5;
const GEOAPIFY_FETCH_CALLS = 1 + GEOAPIFY_SUBLEVELS;

interface OfficialDatasetRow {
  country: string;
  source: string;
  chosen: number;
  usable: number;
  licence: string | null;
  dataset_date: string | null;
  quality: string | null;
  url: string | null;
  levels: string | null;
  note: string | null;
}

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
  // In-memory name index per offline source — see boundary-matcher.ts. A
  // source the DB holds no rows for has no entry.
  private indexes = new Map<OfflineSource, BoundaryIndex>();
  // The `boundaries` table's columns, read once: older DBs lack some.
  private columns = new Set<string>();
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
      const info = this.db.prepare('PRAGMA table_info(boundaries)');
      this.columns = new Set((info.all() as TableColumn[]).map((c) => c.name));
      this.indexes = this.buildIndexes();
    } catch (e) {
      console.warn(
        'Overture SQLite database not found or cannot be opened. Overture fallback will be disabled.',
        e,
      );
    }
  }

  // Names only (no geometry). Tolerates DBs that predate a pipeline step: a
  // column the table lacks (e.g. parent_id before build_hierarchy.py ran, or
  // source before official.py) is read as NULL instead of failing the source.
  private buildIndexes(): Map<OfflineSource, BoundaryIndex> {
    const db = this.db as Database.Database;
    const cols = INDEX_COLUMNS.map((c) =>
      this.columns.has(c) ? c : `NULL AS ${c}`,
    );
    const started = Date.now();
    const select = db.prepare(`SELECT ${cols.join(', ')} FROM boundaries`);
    const bySource = new Map<OfflineSource, IndexRow[]>();
    for (const row of select.all() as IndexRow[]) {
      for (const src of offlineSourcesOf(row)) {
        const list = bySource.get(src);
        if (list) list.push(row);
        else bySource.set(src, [row]);
      }
    }
    const indexes = new Map<OfflineSource, BoundaryIndex>();
    for (const [src, rows] of bySource) {
      indexes.set(src, new BoundaryIndex(rows));
    }
    const ms = Date.now() - started;
    const sizes = [...indexes].map(([src, idx]) => `${src} ${idx.size}`);
    this.logger.log(`Name indexes: ${sizes.join(', ')} places in ${ms}ms`);
    return indexes;
  }

  // Search results carry no polygons — the configurator reads only their
  // properties, and /boundary/fetch serves geometry for the place picked.
  /** Which boundary sources this server can answer right now. */
  sources(): Record<OfflineSource | 'geoapify', boolean> {
    return {
      overture: this.indexes.has('overture'),
      official: this.indexes.has('official'),
      cod: this.indexes.has('cod'),
      geoboundaries: this.indexes.has('geoboundaries'),
      geoapify: !!this.configService.get<string>('GEOAPIFY_API_KEY'),
    };
  }

  /** What the offline DB holds (the bootstrap's meta table), or null without one. */
  overtureInfo(): Record<string, string | number> | null {
    const index = this.indexes.get('overture');
    if (!this.db || !index) return null;
    const meta = this.hasTable('meta')
      ? (this.db.prepare('SELECT key, value FROM meta').all() as {
          key: string;
          value: string;
        }[])
      : [];
    return {
      places: index.size,
      ...Object.fromEntries(meta.map((m) => [m.key, m.value])),
    };
  }

  /**
   * Per country: the official set in use, where it comes from, its licence
   * (attribution is a condition of every one of them) and the levels kept.
   * Null when the DB has no official sets.
   */
  officialInfo(): Record<string, unknown> | null {
    if (!this.db || !this.hasTable('official_datasets')) return null;
    const rows = this.db
      .prepare('SELECT * FROM official_datasets ORDER BY country, source')
      .all() as OfficialDatasetRow[];
    const out: Record<string, unknown> = {};
    for (const r of rows) {
      if (!r.chosen) continue;
      let levels: {
        level: string;
        areas: number;
        areas_kept?: number;
        kept: boolean;
      }[] = [];
      try {
        levels = JSON.parse(r.levels || '[]');
      } catch {
        levels = [];
      }
      out[r.country] = {
        source: r.source,
        licence: r.licence,
        dataset_date: r.dataset_date,
        quality: r.quality,
        url: r.url,
        levels: levels
          .filter((l) => l.kept)
          .map((l) => ({ level: l.level, areas: l.areas_kept ?? l.areas })),
        skipped: rows
          .filter((o) => o.country === r.country && !o.chosen)
          .map((o) => ({ source: o.source, note: o.note })),
      };
    }
    return out;
  }

  private hasTable(name: string): boolean {
    return !!(this.db as Database.Database)
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(name);
  }

  /** The loaded index for an offline source, or a 503 that says what is missing. */
  private offlineIndex(source: OfflineSource): BoundaryIndex {
    const index = this.db ? this.indexes.get(source) : undefined;
    if (!index) {
      throw new HttpException(
        source === 'overture'
          ? 'Overture database is not available locally.'
          : `This server's boundary DB has no '${source}' boundaries — rebuild it with the turbopass bootstrap (OFFICIAL_SOURCES).`,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return index;
  }

  private takeGeoapify(calls = 1): void {
    if (!this.geoapifyLimiter.canEverTake(calls)) {
      // A cap below one request's needs can never be met: say so, instead of
      // a "retry" that never succeeds.
      throw new HttpException(
        `GEOAPIFY_RATE_LIMIT=${this.geoapifyLimiter.limitPerWindow} is below the ${calls} Geoapify calls this request needs. Raise it to at least ${GEOAPIFY_FETCH_CALLS} (or 0 for no cap).`,
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const wait = this.geoapifyLimiter.tryTake(calls);
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

  // `match` and `limit` shape the offline searches only; geoapify ignores them.
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
        return {
          type: 'FeatureCollection',
          features: geoapifySearchFeatures(response.data),
        };
      } catch (error: any) {
        throw new HttpException(
          error.response?.data?.message || 'Geoapify search request failed',
          error.response?.status || HttpStatus.BAD_GATEWAY,
        );
      }
    } else if (isOfflineSource(source)) {
      const index = this.offlineIndex(source);
      try {
        const hits = index.search(query, match, limit, minDescendants);
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
                source: h.source ?? 'overture',
                licence: h.licence,
                level_name: h.level_name,
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

  /** `b.col` for each column the table has, `NULL AS col` for the rest. */
  private optionalColumns(names: string[]): string {
    return names
      .map((n) => (this.columns.has(n) ? `b.${n}` : `NULL AS ${n}`))
      .join(', ');
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

      // Reserve every call this fetch can make before making any: running out
      // halfway would fail the request after spending the quota, and each
      // retry would spend it again.
      this.takeGeoapify(GEOAPIFY_FETCH_CALLS);
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

      for (let sublevel = 1; sublevel <= GEOAPIFY_SUBLEVELS; sublevel++) {
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
        features: geoapifyFetchFeatures(allFeatures),
      };
    } else if (isOfflineSource(source)) {
      const index = this.offlineIndex(source);
      const under = index.descendantsOf(id);
      if (under === undefined) {
        throw new HttpException(
          `No place with id '${id}' in the '${source}' boundaries.`,
          HttpStatus.NOT_FOUND,
        );
      }

      const total = 1 + under;
      if (this.maxFetchFeatures > 0 && total > this.maxFetchFeatures) {
        throw new HttpException(
          `"${index.nameOf(id) ?? id}" has ${total - 1} areas under it — more than this server returns in one fetch (${this.maxFetchFeatures}). Pick a smaller area inside it.`,
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
          SELECT b.id, b.name, b.country, b.subtype, b.admin_level, b.geometry,
                 ${this.optionalColumns(['source', 'licence', 'pcode'])}
          FROM boundaries b
          WHERE b.id IN children
          -- Deterministic order: clients assign codes for same-named areas
          -- (X, X_2) in the order areas arrive.
          ORDER BY b.id
        `);
        const rows = stmt.all(id);

        return {
          type: 'FeatureCollection',
          features: withDepths(
            rows.map((r: any) => ({
              type: 'Feature',
              properties: {
                place_id: r.id,
                name: r.name,
                formatted: `${r.name}, ${r.country}`,
                admin_level: r.admin_level || 0,
                subtype: r.subtype,
                level_name: levelNameFor(r),
                source: r.source ?? 'overture',
                licence: r.licence,
                pcode: r.pcode,
              },
              geometry: JSON.parse(r.geometry || '{}'),
            })),
          ),
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
