import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';
import * as path from 'path';
import Database from 'better-sqlite3';

@Injectable()
export class BoundaryService {
  private db: any;

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
    } catch (e) {
      console.warn('Overture SQLite database not found or cannot be opened. Overture fallback will be disabled.', e);
    }
  }

  async search(query: string, source: string): Promise<any> {
    if (source === 'geoapify') {
      const apiKey = this.configService.get<string>('GEOAPIFY_API_KEY');
      if (!apiKey) {
        throw new HttpException('GEOAPIFY_API_KEY config is missing', HttpStatus.INTERNAL_SERVER_ERROR);
      }
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
      if (!this.db) {
        throw new HttpException('Overture database is not available locally.', HttpStatus.SERVICE_UNAVAILABLE);
      }
      try {
        const stmt = this.db.prepare(`
          SELECT id, name, country, admin_level, bbox, geometry 
          FROM boundaries 
          WHERE name LIKE ? 
          LIMIT 10
        `);
        const rows = stmt.all(`%${query}%`);
        
        return {
          type: 'FeatureCollection',
          features: rows.map((r: any) => ({
            type: 'Feature',
            properties: {
              place_id: r.id,
              formatted: `${r.name}, ${r.country}`,
              name: r.name,
              country_code: r.country,
              category: 'administrative',
              city: r.name,
              admin_level: r.admin_level,
            },
            bbox: JSON.parse(r.bbox || '[]'),
            geometry: JSON.parse(r.geometry || '{}'),
          }))
        };
      } catch (error: any) {
        throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
      }
    } else {
      throw new HttpException(`Source '${source}' is not supported yet`, HttpStatus.BAD_REQUEST);
    }
  }

  async fetchBoundaries(id: string, source: string): Promise<any> {
    if (source === 'geoapify') {
      const apiKey = this.configService.get<string>('GEOAPIFY_API_KEY');
      if (!apiKey) {
        throw new HttpException('GEOAPIFY_API_KEY config is missing', HttpStatus.INTERNAL_SERVER_ERROR);
      }

      const allFeatures: any[] = [];

      try {
        const placeUrl = `https://api.geoapify.com/v2/place-details?id=${encodeURIComponent(id)}&features=details,geometry&apiKey=${apiKey}`;
        const placeRes$ = this.httpService.get(placeUrl);
        const placeRes = await lastValueFrom(placeRes$);
        const rootFeatures = placeRes.data?.features || [];
        allFeatures.push(...rootFeatures);
      } catch (error: any) {
        console.warn(`Failed to fetch root place details for ${id}:`, error.message);
      }

      for (let sublevel = 1; sublevel <= 5; sublevel++) {
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
          console.warn(`Failed to fetch sublevel ${sublevel} for ${id}:`, error.message);
          break;
        }
      }

      return {
        type: 'FeatureCollection',
        features: allFeatures,
      };
    } else if (source === 'overture') {
      if (!this.db) {
        throw new HttpException('Overture database is not available locally.', HttpStatus.SERVICE_UNAVAILABLE);
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
            },
            geometry: JSON.parse(r.geometry || '{}')
          }))
        };
      } catch (error: any) {
        throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
      }
    } else {
      throw new HttpException(`Source '${source}' is not supported yet`, HttpStatus.BAD_REQUEST);
    }
  }
}
