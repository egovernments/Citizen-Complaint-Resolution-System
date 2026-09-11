/**
 * xlsx-loader.ts — Phase orchestrator for xlsx-based tenant setup.
 * Sequences 4 phases (Tenant → Boundaries → Masters → Employees),
 * manages cross-phase state, and calls DigitApiClient methods.
 */
import * as fs from 'fs';
import {
  loadWorkbook,
  readTenantInfo,
  readTenantBranding,
  readDepartmentsDesignations,
  readComplaintTypes,
  readEmployees,
} from './xlsx-reader.js';
import { digitApi } from '../services/digit-api.js';
import type ExcelJS from 'exceljs';

// ── Types ──

export interface PhaseResult {
  status: 'completed' | 'skipped' | 'failed';
  error?: string;
  [key: string]: unknown;
}

export interface XlsxLoadResult {
  success: boolean;
  tenant_id: string;
  phases: {
    tenant?: PhaseResult;
    boundaries?: PhaseResult;
    masters?: PhaseResult;
    employees?: PhaseResult;
  };
}

interface RowStatus {
  name: string;
  code?: string;
  status: 'created' | 'exists' | 'failed';
  error?: string;
}

// ── File Resolution ──

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve a file reference to a Buffer.
 * - Local path (starts with / or ./) → fs.readFileSync
 * - UUID → download from DIGIT filestore
 */
async function resolveFile(ref: string, tenantId: string): Promise<Buffer> {
  if (ref.startsWith('/') || ref.startsWith('./') || ref.startsWith('../')) {
    return fs.readFileSync(ref);
  }

  if (UUID_RE.test(ref)) {
    // Download from DIGIT filestore
    const root = tenantId.includes('.') ? tenantId.split('.')[0] : tenantId;
    const urls = await digitApi.filestoreGetUrl(root, [ref]);
    if (!urls.length) throw new Error(`FileStore ID "${ref}" not found`);

    const downloadUrl = (urls[0] as Record<string, unknown>).url as string;
    if (!downloadUrl) throw new Error(`No download URL for fileStoreId "${ref}"`);

    const response = await fetch(downloadUrl);
    if (!response.ok) throw new Error(`Failed to download file: ${response.status}`);

    const arrayBuf = await response.arrayBuffer();
    return Buffer.from(arrayBuf);
  }

  throw new Error(
    `Cannot resolve file "${ref}". Expected a local path (starting with /) or a fileStoreId (UUID format).`,
  );
}

// ── Phase Handlers ──

async function runTenantPhase(
  tenantId: string,
  fileRef: string,
): Promise<PhaseResult> {
  const root = tenantId.includes('.') ? tenantId.split('.')[0] : tenantId;
  // The city portion of the target tenant_id (e.g. "poc-mzpt" from "ke.poc-mzpt").
  // If the operator passed a city tenant explicitly, that's what we want to
  // write — the file's "Tenant Code*" is treated as a default the arg overrides.
  const targetCityCode = tenantId.includes('.')
    ? tenantId.split('.').slice(1).join('.').toLowerCase()
    : null;

  const buf = await resolveFile(fileRef, tenantId);
  const workbook = await loadWorkbook(buf);
  const { tenants, localizations } = readTenantInfo(workbook);

  // If caller pinned a target city tenant and the file row's code disagrees,
  // make the arg authoritative. The wizard does the same: the operator picks
  // the target tenant before uploading.
  if (targetCityCode && tenants.length === 1 && tenants[0].code !== targetCityCode) {
    tenants[0].code = targetCityCode;
  }

  let created = 0;
  let skipped = 0;
  let failedCount = 0;
  const rows: RowStatus[] = [];

  for (const tenant of tenants) {
    const uniqueId = `Tenant.${tenant.code}`;
    try {
      await digitApi.mdmsV2Create(root, 'tenant.tenants', uniqueId, {
        code: tenant.code,
        name: tenant.name,
        tenantId: tenant.code,
        parent: root,
        city: tenant.city,
        domainUrl: tenant.domainUrl,
      });
      created++;
      rows.push({ name: tenant.name, code: tenant.code, status: 'created' });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (/already exists|duplicate|unique/i.test(msg)) {
        skipped++;
        rows.push({ name: tenant.name, code: tenant.code, status: 'exists' });
      } else {
        failedCount++;
        rows.push({ name: tenant.name, code: tenant.code, status: 'failed', error: msg });
      }
    }
  }

  // Handle optional branding sheet
  const brandingRecords = readTenantBranding(workbook);
  let brandingCreated = 0;
  for (const branding of brandingRecords) {
    try {
      await digitApi.mdmsV2Create(root, 'tenant.citymodule', `Branding.${branding.code}`, branding as unknown as Record<string, unknown>);
      brandingCreated++;
    } catch {
      // Non-fatal — branding is optional
    }
  }

  // Upsert localizations
  let localizationKeys = 0;
  if (localizations.length > 0) {
    try {
      await digitApi.localizationUpsert(root, 'en_IN', localizations);
      localizationKeys = localizations.length;
    } catch {
      // Non-fatal — log but don't fail the phase
    }
  }

  return {
    status: failedCount > 0 && created === 0 ? 'failed' : 'completed',
    created,
    skipped,
    failed: failedCount,
    branding_created: brandingCreated,
    localization_keys: localizationKeys,
    rows,
  };
}

interface BoundaryRow {
  code: string;
  name: string;
  boundaryType: string;
  parentCode?: string;
  latitude?: number;
  longitude?: number;
}

export interface BoundaryContext {
  hierarchyType: string;
  rootBoundaryCode: string;
  rootBoundaryType: string;
  levels: string[];
}

/**
 * Normalize a string for fuzzy matching of GeoJSON feature names to boundary
 * codes. The XLSX side typically stores codes as lowercase ascii with
 * underscores (`kamavota`), while OSM / GIS exports use mixed-case display
 * names with diacritics and spaces (`KaMavota`, `KaMpfumu`, `Distrito
 * Municipal de KaMpfumu`). This brings both to a common shape.
 */
function normalizeForMatch(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/^distrito municipal de\s+/, '') // OSM-style prefix on Maputo distritos
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Localization for one boundary code/name pair. Ports
 * configurator/src/api/services/localization.ts's buildBoundaryLocalizations
 * so both onboarding paths produce identical keys: the bare code (what the
 * PGR create-complaint dropdown looks up via `t(boundary.code)`) plus a
 * tenant+hierarchyType-prefixed variant (used by map/BPr components). Module
 * is lower-cased to match the reader convention on the consuming side
 * (digit-ui-esbuild and frontend/micro-ui both build it as
 * `boundary-${hierarchyType.toLowerCase()}`).
 */
function buildBoundaryLocalizations(
  tenantId: string,
  code: string,
  name: string,
  hierarchyType: string,
): { code: string; message: string; module: string }[] {
  const module = `rainmaker-boundary-${hierarchyType.toLowerCase()}`;
  const tenantPrefix = tenantId.toUpperCase().replace(/\./g, '_');
  const prefixedCode = `${tenantPrefix}_${hierarchyType}_${code}`;
  const messages = [{ code, message: name, module }];
  if (prefixedCode !== code) {
    messages.push({ code: prefixedCode, message: name, module });
  }
  return messages;
}

/**
 * Localization for boundary hierarchy level labels (e.g. "Bairro",
 * "Quarteirão") — ports buildHierarchyLevelLocalizations from the same
 * configurator service. BoundaryComponent.js builds its dropdown-label key
 * as `${hierarchyType}_${boundaryType.toUpperCase()}`; the original-case and
 * fully-uppercase variants are back-compat / map-component keys. All three
 * land in rainmaker-common, the only module guaranteed loaded at startup.
 */
function buildHierarchyLevelLocalizations(
  hierarchyType: string,
  levels: string[],
): { code: string; message: string; module: string }[] {
  const module = 'rainmaker-common';
  const seen = new Set<string>();
  const messages: { code: string; message: string; module: string }[] = [];
  for (const boundaryType of levels) {
    const push = (code: string) => {
      if (seen.has(code)) return;
      seen.add(code);
      messages.push({ code, message: boundaryType, module });
    };
    push(`${hierarchyType}_${boundaryType.toUpperCase()}`);
    push(`${hierarchyType}_${boundaryType}`);
    push(`${hierarchyType}_${boundaryType}`.toUpperCase());
  }
  return messages;
}

/**
 * boundary-service /boundary/_create only accepts `Point` and `Polygon`
 * geometries — it 400s on `MultiPolygon` even though jsonb storage doesn't
 * care. OSM exports (e.g. Maputo bairros) come back as MultiPolygon for
 * any feature with disconnected islands or stray fragments. To stay in
 * compatible territory we collapse MultiPolygon to a single Polygon by
 * picking the ring set with the most coordinates (i.e. the largest
 * contiguous piece), which is the right call ~always for admin boundaries.
 */
function coerceForBoundaryService(geom: Record<string, unknown>): Record<string, unknown> {
  if (geom?.type !== 'MultiPolygon' || !Array.isArray(geom.coordinates)) return geom;
  const polys = geom.coordinates as unknown[][][];
  if (polys.length === 0) return geom;
  let largestIdx = 0;
  let largestPoints = 0;
  for (let i = 0; i < polys.length; i++) {
    const outer = polys[i]?.[0];
    const pts = Array.isArray(outer) ? outer.length : 0;
    if (pts > largestPoints) { largestPoints = pts; largestIdx = i; }
  }
  return { type: 'Polygon', coordinates: polys[largestIdx] };
}

/**
 * Parse a GeoJSON sidecar file into a `code → geometry` lookup. Each feature
 * is keyed by `properties.code` (preferred) or normalized `properties.name`
 * (fallback). Returns the map plus stats so the caller can surface how many
 * boundaries got matched vs. dropped to the operator.
 */
function loadGeoJsonSidecar(geojsonText: string): {
  byCode: Map<string, Record<string, unknown>>;
  totalFeatures: number;
  withCode: number;
  withName: number;
  skipped: number;
} {
  const byCode = new Map<string, Record<string, unknown>>();
  let withCode = 0;
  let withName = 0;
  let skipped = 0;
  let parsed: { features?: Array<{ properties?: Record<string, unknown>; geometry?: Record<string, unknown> }> };
  try {
    parsed = JSON.parse(geojsonText);
  } catch (e) {
    throw new Error(`Could not parse boundary_geojson_file as JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  const features = parsed.features ?? [];
  for (const f of features) {
    const props = f.properties ?? {};
    const geom = f.geometry;
    if (!geom) { skipped++; continue; }
    const explicitCode = typeof props.code === 'string' ? props.code.trim() : '';
    if (explicitCode) {
      byCode.set(explicitCode, geom);
      withCode++;
      continue;
    }
    const name = typeof props.name === 'string' ? props.name.trim() : '';
    if (name) {
      byCode.set(normalizeForMatch(name), geom);
      withName++;
      continue;
    }
    skipped++;
  }
  return { byCode, totalFeatures: features.length, withCode, withName, skipped };
}

async function runBoundaryPhase(
  tenantId: string,
  fileRef: string,
  hierarchyTypeOverride?: string,
  geojsonFileRef?: string,
): Promise<PhaseResult & { context?: BoundaryContext }> {
  const buf = await resolveFile(fileRef, tenantId);

  // Parse the file once: full rows, plus the distinct boundary-type levels
  // in topo order (root first). Used both to detect / create the hierarchy
  // definition and to drive iterative entity+relationship creation.
  const { levels: fileLevels, rows } = await extractBoundaryFile(buf);
  if (fileLevels.length === 0 || rows.length === 0) {
    return {
      status: 'failed',
      error: "Couldn't read any boundary rows from the file. " +
        "Expected a 'Boundary' (or 'Boundaries'/'BoundaryMaster'/'boundary') sheet with " +
        "columns 'code', 'name', 'boundaryType', 'parentCode'.",
    };
  }

  // Resolve hierarchy: caller override → existing match (at city) → auto-create.
  // Hierarchies do NOT inherit across tenants in egov-bndry-mgmnt, so we only
  // search at the city tenant and create there too. This is what the
  // configurator does.
  let hierarchyType = hierarchyTypeOverride;
  let hierarchyAction: 'used' | 'created' = 'used';

  if (!hierarchyType) {
    const cityHierarchies = await digitApi.boundaryHierarchySearch(tenantId).catch(() => []);
    const match = (cityHierarchies as Record<string, unknown>[])
      .find((h) => hierarchyMatchesLevels(h, fileLevels));
    if (match) {
      hierarchyType = match.hierarchyType as string;
    } else {
      const cityCode = tenantId.includes('.') ? tenantId.split('.').slice(1).join('-') : tenantId;
      hierarchyType = `${cityCode.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}_ADMIN`;
      const hierarchyDef = fileLevels.map((level, idx) => ({
        boundaryType: level,
        parentBoundaryType: idx === 0 ? null : fileLevels[idx - 1],
        active: true,
      }));
      try {
        await digitApi.boundaryHierarchyCreate(tenantId, hierarchyType, hierarchyDef);
        hierarchyAction = 'created';
      } catch (err) {
        return {
          status: 'failed',
          error: `Failed to auto-create boundary hierarchy "${hierarchyType}" at "${tenantId}": ` +
            (err instanceof Error ? err.message : String(err)),
          fileLevels,
        };
      }
    }
  }

  // Group rows by level, processing parents before children (boundary
  // service requires parent boundary entity + relationship to exist before
  // we can create a child relationship pointing at it).
  const rowsByLevel = new Map<string, BoundaryRow[]>();
  for (const r of rows) {
    const arr = rowsByLevel.get(r.boundaryType) ?? [];
    arr.push(r);
    rowsByLevel.set(r.boundaryType, arr);
  }

  const entityStats = { created: 0, exists: 0, failed: 0 };
  const relStats = { created: 0, exists: 0, failed: 0 };
  const entityFailures: string[] = [];
  const relFailures: string[] = [];

  // Optional GeoJSON sidecar: map of boundary code (or normalized name) →
  // GeoJSON geometry. Lets operators ship real Polygon / MultiPolygon
  // outlines without trying to cram them into an XLSX cell. Sidecar wins
  // over per-row lat/long; lat/long wins over the digit-api Point[0,0]
  // default.
  let geojsonByCode: Map<string, Record<string, unknown>> | undefined;
  let geojsonStats: ReturnType<typeof loadGeoJsonSidecar> | undefined;
  if (geojsonFileRef) {
    const geojsonBuf = await resolveFile(geojsonFileRef, tenantId);
    geojsonStats = loadGeoJsonSidecar(geojsonBuf.toString('utf8'));
    geojsonByCode = geojsonStats.byCode;
  }
  const geometryFor = (b: BoundaryRow): Record<string, unknown> | undefined => {
    if (geojsonByCode) {
      const hit = geojsonByCode.get(b.code) ?? geojsonByCode.get(normalizeForMatch(b.name));
      if (hit) return coerceForBoundaryService(hit);
    }
    if (Number.isFinite(b.longitude) && Number.isFinite(b.latitude)) {
      return { type: 'Point', coordinates: [b.longitude, b.latitude] };
    }
    return undefined;
  };

  // Build the boundary-service payload for a parsed row. Geometry comes from
  // (in order): geojson sidecar by code, geojson sidecar by normalized name,
  // XLSX latitude/longitude, or the digit-api default Point[0,0].
  const toBoundaryPayload = (b: BoundaryRow) => {
    const payload: { code: string; geometry?: Record<string, unknown> } = { code: b.code };
    const g = geometryFor(b);
    if (g) payload.geometry = g;
    return payload;
  };

  // ── Phase A: create ALL entities first (every level), batched ──
  // egov-boundary-service /boundary/_create takes an array, so 100-at-a-time
  // keeps round-trips low without blowing past payload limits.
  for (const level of fileLevels) {
    const levelRows = rowsByLevel.get(level) ?? [];
    const BATCH = 100;
    for (let i = 0; i < levelRows.length; i += BATCH) {
      const batch = levelRows.slice(i, i + BATCH);
      try {
        await digitApi.boundaryCreate(tenantId, batch.map(toBoundaryPayload));
        entityStats.created += batch.length;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/already exists|duplicate/i.test(msg)) {
          // Some batched entities already existed — fall back to one-at-a-time
          // so we can count exists vs. created cleanly without re-failing.
          for (const b of batch) {
            try {
              await digitApi.boundaryCreate(tenantId, [toBoundaryPayload(b)]);
              entityStats.created++;
            } catch (innerErr) {
              const innerMsg = innerErr instanceof Error ? innerErr.message : String(innerErr);
              if (/already exists|duplicate/i.test(innerMsg)) {
                entityStats.exists++;
              } else {
                entityStats.failed++;
                if (entityFailures.length < 10) entityFailures.push(`${b.code}: ${innerMsg}`);
              }
            }
          }
        } else {
          entityStats.failed += batch.length;
          if (entityFailures.length < 10) entityFailures.push(`batch ${i}: ${msg}`);
        }
      }
    }
  }

  // ── Phase B: ENTITY GATE — wait until every entity is readable before any
  // relationship is created. boundary-service entity _create is Kafka-backed:
  // it returns 200 before the row is consistently readable, and relationship
  // _create validates entity existence, so without this barrier a subset of
  // relationships race ahead of their entity ("Boundary entity does not exist")
  // and their children cascade. (A per-level ~5s retry can't keep up at
  // thousands of rows.) Poll boundary search until all expected codes appear.
  // /boundary/_search caps results (~300), so we can't count all entities in
  // one call — verify the exact codes via the `codes` filter in chunks.
  const expectedCodeList = rows.map((r) => r.code);
  const expectedCount = new Set(expectedCodeList).size;
  const GATE_TIMEOUT_MS = 180000;
  const GATE_INTERVAL_MS = 2000;
  const CODES_CHUNK = 200; // keep each query under the result cap
  const countVisibleEntities = async (): Promise<number> => {
    const seen = new Set<string>();
    for (let i = 0; i < expectedCodeList.length; i += CODES_CHUNK) {
      const chunk = expectedCodeList.slice(i, i + CODES_CHUNK);
      // explicit limit: /boundary/_search defaults to 50 results even when
      // codes are supplied, so without this the gate undercounts and stalls.
      const res = await digitApi
        .boundarySearch(tenantId, undefined, { codes: chunk, limit: chunk.length })
        .catch(() => [] as Record<string, unknown>[]);
      const present = new Set((res as Record<string, unknown>[]).map((e) => e.code as string));
      for (const c of chunk) if (present.has(c)) seen.add(c);
    }
    return seen.size;
  };
  const gateStart = Date.now();
  let entitiesVisible = 0;
  while (Date.now() - gateStart < GATE_TIMEOUT_MS) {
    entitiesVisible = await countVisibleEntities();
    if (entitiesVisible >= expectedCount) break;
    await new Promise((resolve) => setTimeout(resolve, GATE_INTERVAL_MS));
  }
  const entityGate = {
    expected: expectedCount,
    visible: entitiesVisible,
    complete: entitiesVisible >= expectedCount,
    waitedMs: Date.now() - gateStart,
  };

  // ── Phase C: create relationships top-down (levels root→leaf). A child
  // relationship needs its parent's relationship to exist, so level order
  // matters; the gate above guarantees the entities are visible. Keep a
  // bounded retry as a safety net for any residual lag / parent stragglers.
  for (const level of fileLevels) {
    const levelRows = rowsByLevel.get(level) ?? [];
    const pending: BoundaryRow[] = [...levelRows];
    const maxPasses = 5;
    for (let pass = 0; pass < maxPasses && pending.length > 0; pass++) {
      if (pass > 0) {
        const backoffMs = 1000 * pass;
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
      const stillPending: BoundaryRow[] = [];
      for (const b of pending) {
        try {
          await digitApi.boundaryRelationshipCreate(
            tenantId, b.code, hierarchyType, b.boundaryType, b.parentCode ?? null,
          );
          relStats.created++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (/already exists|duplicate/i.test(msg)) {
            relStats.exists++;
          } else if (/does not exist|DOES_NOT_EXIST/i.test(msg) && pass < maxPasses - 1) {
            stillPending.push(b);
          } else {
            relStats.failed++;
            if (relFailures.length < 10) relFailures.push(`${b.code} (pass ${pass}): ${msg}`);
          }
        }
      }
      pending.length = 0;
      pending.push(...stillPending);
    }
  }

  const rootRow = rows.find((r) => !r.parentCode) || rows[0];
  const context: BoundaryContext = {
    hierarchyType,
    rootBoundaryCode: rootRow.code,
    rootBoundaryType: rootRow.boundaryType,
    levels: fileLevels,
  };

  // ── Phase D: seed localization ──
  // This xlsx path created boundary entities + relationships but never wrote
  // any localization messages, so the citizen/employee PGR boundary picker
  // rendered raw boundaryTypes/codes instead of real names — for every
  // level, not just the deepest one (egovernments/CCRS#721). Mirrors
  // configurator/src/api/services/localization.ts's
  // buildBoundaryLocalizations / buildHierarchyLevelLocalizations, which
  // already do this correctly for the other (SPA) onboarding path.
  let localizationKeys = 0;
  try {
    const boundaryMessages = rows.flatMap((r) =>
      buildBoundaryLocalizations(tenantId, r.code, r.name, hierarchyType),
    );
    const levelMessages = buildHierarchyLevelLocalizations(hierarchyType, fileLevels);
    const seenCodes = new Set<string>();
    const localizationMessages = [...boundaryMessages, ...levelMessages].filter((m) => {
      if (seenCodes.has(m.code)) return false;
      seenCodes.add(m.code);
      return true;
    });
    if (localizationMessages.length > 0) {
      await digitApi.localizationUpsert(tenantId, 'en_IN', localizationMessages);
      localizationKeys = localizationMessages.length;
    }
  } catch {
    // Non-fatal — boundaries are already created; localization can be
    // re-seeded separately if this call fails.
  }

  const failed = entityStats.failed + relStats.failed;
  const created = entityStats.created + relStats.created;

  // Track how many rows actually picked up geometry from the sidecar — useful
  // operator feedback when feature names don't line up with boundary codes.
  let geojsonMatchedRows = 0;
  if (geojsonByCode) {
    for (const r of rows) {
      if (geojsonByCode.get(r.code) || geojsonByCode.get(normalizeForMatch(r.name))) {
        geojsonMatchedRows++;
      }
    }
  }

  return {
    status: failed > 0 && created === 0 ? 'failed' : 'completed',
    message: `Hierarchy ${hierarchyAction}: ${hierarchyType}. ` +
      `Entities ${entityStats.created} created, ${entityStats.exists} existed, ${entityStats.failed} failed. ` +
      `Relationships ${relStats.created} created, ${relStats.exists} existed, ${relStats.failed} failed.` +
      (geojsonStats
        ? ` Polygon sidecar: ${geojsonMatchedRows}/${rows.length} rows matched (${geojsonStats.totalFeatures} features in file).`
        : ''),
    hierarchyType,
    hierarchyAction,
    levels: fileLevels,
    counts: { entities: entityStats, relationships: relStats, total_rows: rows.length, entity_gate: entityGate },
    entity_failures: entityFailures,
    relationship_failures: relFailures,
    localization_keys: localizationKeys,
    context,
    ...(geojsonStats && {
      geojson: {
        features: geojsonStats.totalFeatures,
        matched_by_code: geojsonStats.withCode,
        matched_by_name: geojsonStats.withName,
        rows_with_geometry: geojsonMatchedRows,
        rows_without_geometry: rows.length - geojsonMatchedRows,
      },
    }),
  };
}

/**
 * Read the Boundary sheet once. Returns all rows + the distinct boundary-type
 * levels in topological order (root first). Used to detect / build the
 * hierarchy AND to drive iterative entity+relationship creation.
 */
async function extractBoundaryFile(buf: Buffer): Promise<{ levels: string[]; rows: BoundaryRow[] }> {
  const ExcelJSMod = await import('exceljs');
  const wb = new ExcelJSMod.default.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(buf as any);

  const candidates = ['Boundary', 'Boundaries', 'BoundaryMaster', 'boundary'];
  let sheet: import('exceljs').Worksheet | undefined;
  for (const name of candidates) {
    sheet = wb.worksheets.find((ws) => ws.name.toLowerCase() === name.toLowerCase());
    if (sheet) break;
  }
  if (!sheet) return { levels: [], rows: [] };

  const headerRow = sheet.getRow(1);
  const headers: Record<string, number> = {};
  headerRow.eachCell({ includeEmpty: true }, (cell, col) => {
    headers[String(cell.text || '').trim()] = col;
  });
  const typeCol = headers['boundaryType'] ?? headers['BoundaryType'] ?? headers['type'];
  const codeCol = headers['code'] ?? headers['Code'];
  const nameCol = headers['name'] ?? headers['Name'] ?? codeCol;
  const parentCodeCol = headers['parentCode'] ?? headers['ParentCode'] ?? headers['parent'];
  const latCol = headers['latitude'] ?? headers['Latitude'];
  const lngCol = headers['longitude'] ?? headers['Longitude'];
  if (!typeCol || !codeCol) return { levels: [], rows: [] };

  const rows: BoundaryRow[] = [];
  const codeToType = new Map<string, string>();

  sheet.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum === 1) return;
    const code = String(row.getCell(codeCol).text || '').trim();
    const t = String(row.getCell(typeCol).text || '').trim();
    if (!code || !t) return;
    const pc = parentCodeCol ? String(row.getCell(parentCodeCol).text || '').trim() : '';
    const name = nameCol ? String(row.getCell(nameCol).text || '').trim() : code;
    const lat = latCol ? Number(row.getCell(latCol).value) : NaN;
    const lng = lngCol ? Number(row.getCell(lngCol).value) : NaN;
    rows.push({
      code,
      name: name || code,
      boundaryType: t,
      parentCode: pc || undefined,
      latitude: Number.isFinite(lat) ? lat : undefined,
      longitude: Number.isFinite(lng) ? lng : undefined,
    });
    codeToType.set(code, t);
  });

  // Topological sort the types based on parent-child relationships found
  // in the data.
  const childParentTypes = new Map<string, string | null>();
  for (const r of rows) {
    const parentType = r.parentCode ? (codeToType.get(r.parentCode) || null) : null;
    if (!childParentTypes.has(r.boundaryType) || (parentType && !childParentTypes.get(r.boundaryType))) {
      childParentTypes.set(r.boundaryType, parentType);
    }
  }

  const ordered: string[] = [];
  const remaining = new Map(childParentTypes);
  while (remaining.size > 0) {
    let progress = false;
    for (const [type, parent] of remaining.entries()) {
      if (!parent || ordered.includes(parent)) {
        ordered.push(type);
        remaining.delete(type);
        progress = true;
      }
    }
    if (!progress) {
      for (const t of remaining.keys()) ordered.push(t);
      break;
    }
  }

  return { levels: ordered, rows };
}

function hierarchyMatchesLevels(
  hierarchy: Record<string, unknown>,
  fileLevels: string[],
): boolean {
  const levels = hierarchy.boundaryHierarchy as Array<{ boundaryType: string }> | undefined;
  if (!Array.isArray(levels)) return false;
  if (levels.length !== fileLevels.length) return false;
  const lower = (s: string) => s.trim().toLowerCase();
  return levels.every((l, i) => lower(l.boundaryType) === lower(fileLevels[i]));
}

async function runMastersPhase(
  tenantId: string,
  fileRef: string,
): Promise<PhaseResult & { deptNameToCode?: Map<string, string>; desigNameToCode?: Map<string, string> }> {
  const root = tenantId.includes('.') ? tenantId.split('.')[0] : tenantId;

  const buf = await resolveFile(fileRef, tenantId);
  const workbook = await loadWorkbook(buf);

  const result: PhaseResult & { deptNameToCode?: Map<string, string> } = {
    status: 'completed',
    departments: { created: 0, exists: 0, failed: 0 } as Record<string, number>,
    designations: { created: 0, exists: 0, failed: 0 } as Record<string, number>,
    complaint_types: { created: 0, exists: 0, failed: 0 } as Record<string, number>,
    localization_keys: 0,
  };

  // ── Departments & Designations ──
  const {
    departments,
    designations,
    localizations: deptDesigLocalizations,
    deptNameToCode,
    desigNameToCode,
  } = readDepartmentsDesignations(workbook);

  // Schema only allows { code, name, active } — projecting explicitly so
  // we don't trip "extraneous key" validation on extra interface fields.
  const deptStats = result.departments as Record<string, number>;
  const deptFailures: string[] = [];
  for (const dept of departments) {
    try {
      await digitApi.mdmsV2Create(root, 'common-masters.Department', dept.code, {
        code: dept.code,
        name: dept.name,
        active: dept.active,
      });
      deptStats.created++;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (/already exists|duplicate|unique/i.test(msg)) {
        deptStats.exists++;
      } else {
        deptStats.failed++;
        deptFailures.push(`${dept.code}: ${msg}`);
      }
    }
  }
  if (deptFailures.length) result.department_failures = deptFailures;

  const desigStats = result.designations as Record<string, number>;
  const desigFailures: string[] = [];
  for (const desig of designations) {
    const payload: Record<string, unknown> = {
      code: desig.code,
      name: desig.name,
      active: desig.active,
    };
    if (desig.description) payload.description = desig.description;
    try {
      await digitApi.mdmsV2Create(root, 'common-masters.Designation', desig.code, payload);
      desigStats.created++;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (/already exists|duplicate|unique/i.test(msg)) {
        desigStats.exists++;
      } else {
        desigStats.failed++;
        desigFailures.push(`${desig.code}: ${msg}`);
      }
    }
  }
  if (desigFailures.length) result.designation_failures = desigFailures;

  // ── Complaint Types (RAINMAKER-PGR.ComplaintHierarchy, 2-master model) ──
  // The reader emits the level Definition + ONE adjacency list (interior
  // CATEGORY nodes AND leaf complaint types). Each row is keyed by its `code`
  // (a leaf's code IS its serviceCode). menuPath is gone; grouping is the tree.
  let complaintDefinition: Record<string, unknown> | null = null;
  let complaintHierarchy: Array<Record<string, unknown>> = [];
  let complaintLocalizations: Array<{ code: string; message: string; module: string }> = [];
  try {
    const parsed = readComplaintTypes(workbook, deptNameToCode);
    complaintDefinition = parsed.definition as unknown as Record<string, unknown>;
    complaintHierarchy = parsed.hierarchy as unknown as Array<Record<string, unknown>>;
    complaintLocalizations = parsed.localizations;
  } catch {
    // Complaint Type Master sheet may be absent — that's OK
  }

  const ctStats = result.complaint_types as Record<string, number>;
  if (complaintDefinition && complaintHierarchy.length > 0) {
    // 1) Level definition (idempotent; keyed by hierarchyType).
    try {
      await digitApi.mdmsV2Create(
        root,
        'RAINMAKER-PGR.ComplaintHierarchyDefinition',
        complaintDefinition.hierarchyType as string,
        complaintDefinition,
      );
    } catch {
      // Already present from a prior run / state seed — non-fatal.
    }
    // 2) Adjacency list. Interior nodes are emitted before leaves so each
    //    leaf's parentCode target already exists.
    for (const row of complaintHierarchy) {
      try {
        await digitApi.mdmsV2Create(root, 'RAINMAKER-PGR.ComplaintHierarchy', row.code as string, row);
        ctStats.created++;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (/already exists|duplicate|unique/i.test(msg)) {
          ctStats.exists++;
        } else {
          ctStats.failed++;
        }
      }
    }
  }

  // ── Localizations ──
  const allLocalizations = [...deptDesigLocalizations, ...complaintLocalizations];
  if (allLocalizations.length > 0) {
    try {
      await digitApi.localizationUpsert(root, 'en_IN', allLocalizations);
      (result as Record<string, unknown>).localization_keys = allLocalizations.length;
    } catch {
      // Non-fatal
    }
  }

  // Pass both maps to Phase 4 so designations created in this same run
  // resolve cleanly without an extra MDMS round-trip.
  result.deptNameToCode = deptNameToCode;
  result.desigNameToCode = desigNameToCode;

  return result;
}

async function runEmployeePhase(
  tenantId: string,
  fileRef: string,
  deptNameToCode?: Map<string, string>,
  desigNameToCode?: Map<string, string>,
  boundaryContext?: BoundaryContext,
): Promise<PhaseResult> {
  const root = tenantId.includes('.') ? tenantId.split('.')[0] : tenantId;

  const buf = await resolveFile(fileRef, tenantId);
  const workbook = await loadWorkbook(buf);
  const employees = readEmployees(workbook);

  // If deptNameToCode not provided from Phase 3, fetch from MDMS
  const deptMap = deptNameToCode || new Map<string, string>();
  const desigMap = desigNameToCode || new Map<string, string>();

  if (deptMap.size === 0) {
    try {
      const depts = await digitApi.mdmsV2Search<Record<string, unknown>>(root, 'common-masters.Department');
      for (const d of depts) {
        deptMap.set(d.name as string, d.code as string);
        deptMap.set(d.code as string, d.code as string);
      }
    } catch {
      // Will proceed with raw names
    }
  }

  if (desigMap.size === 0) {
    try {
      const desigs = await digitApi.mdmsV2Search<Record<string, unknown>>(root, 'common-masters.Designation');
      for (const d of desigs) {
        desigMap.set(d.name as string, d.code as string);
        desigMap.set(d.code as string, d.code as string);
      }
    } catch {
      // Will proceed with raw names
    }
  }

  // Resolve jurisdiction: prefer the boundary context handed in by Phase 2.
  // Falls back to a search at the city tenant for tenants where boundaries
  // were seeded by a different process. The hardcoded `ADMIN`/`City` of the
  // old implementation only worked on tenants that happened to use those
  // exact identifiers.
  let jurisdiction: { hierarchy: string; boundaryType: string; boundary: string; tenantId: string } | undefined;
  if (boundaryContext) {
    jurisdiction = {
      hierarchy: boundaryContext.hierarchyType,
      boundaryType: boundaryContext.rootBoundaryType,
      boundary: boundaryContext.rootBoundaryCode,
      tenantId,
    };
  } else {
    try {
      const hierarchies = await digitApi.boundaryHierarchySearch(tenantId);
      const h = hierarchies[0] as Record<string, unknown> | undefined;
      const levels = h?.boundaryHierarchy as Array<{ boundaryType: string }> | undefined;
      const topType = levels?.[0]?.boundaryType;
      if (h && topType) {
        // Need a boundary code at the top level. Cheapest: search by tenant.
        const boundaries = await digitApi.boundarySearch(tenantId, topType).catch(() => []);
        const topCode = (boundaries[0] as Record<string, unknown> | undefined)?.code as string | undefined;
        if (topCode) {
          jurisdiction = {
            hierarchy: h.hierarchyType as string,
            boundaryType: topType,
            boundary: topCode,
            tenantId,
          };
        }
      }
    } catch {
      // Fall through — employee create will fail loudly with jurisdiction errors.
    }
  }

  const rows: RowStatus[] = [];
  let created = 0;
  let existsCount = 0;
  let failedCount = 0;

  const dayMs = 86_400_000;
  for (const emp of employees) {
    // departmentName accepts a comma-separated list. HRMS only allows one
    // current assignment with non-overlapping windows, so extra departments
    // become 1-day historical assignments in the past — the same pattern
    // tenant_bootstrap uses for ADMIN. PGR's department validation accepts
    // an assignee when ANY assignment matches the complaint's department.
    const deptCodes = emp.departmentName
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => deptMap.get(d) || d);
    const desigCode = desigMap.get(emp.designationName) || emp.designationName;

    const assignments = deptCodes.map((deptCode, idx) =>
      idx === 0
        ? {
            department: deptCode,
            designation: desigCode,
            fromDate: emp.joiningDate,
            isCurrentAssignment: true,
            tenantId,
          }
        : {
            department: deptCode,
            designation: desigCode,
            fromDate: emp.joiningDate - (idx + 1) * dayMs,
            toDate: emp.joiningDate - idx * dayMs,
            isCurrentAssignment: false,
            tenantId,
          },
    );

    const jurisdictions = jurisdiction ? [jurisdiction] : [];

    const user: Record<string, unknown> = {
      name: emp.name,
      mobileNumber: emp.mobileNumber,
      userName: emp.userName || emp.code,
      password: emp.password,
      tenantId,
      roles: emp.roleNames.map((r) => ({
        code: r,
        name: r,
        tenantId,
      })),
    };
    // HRMS user validation requires gender + dob to be non-null. Fall back
    // to sensible defaults when the file omits them so the create doesn't
    // fail with "must not be null". Operator can later edit via UI.
    user.gender = emp.gender || 'OTHERS';
    user.dob = emp.dob ?? 631152000000; // 1990-01-01 sentinel
    if (emp.emailId) user.emailId = emp.emailId;

    try {
      await digitApi.employeeCreate(tenantId, [
        {
          code: emp.code,
          employeeStatus: 'EMPLOYED',
          employeeType: 'PERMANENT',
          // Every assignment's fromDate must be >= dateOfAppointment — with
          // multi-department historical windows, anchor it before the earliest.
          dateOfAppointment:
            deptCodes.length > 1
              ? Math.min(emp.appointmentDate, emp.joiningDate - (deptCodes.length + 1) * dayMs)
              : emp.appointmentDate,
          user,
          assignments,
          jurisdictions,
        },
      ]);
      created++;
      rows.push({ name: emp.name, code: emp.code, status: 'created' });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      // Idempotent re-runs: HRMS / egov-user respond with "User already exists"
      // when the username or mobile is already taken. That's a successful
      // no-op from the operator's perspective, not a failure.
      if (/already exists|duplicate/i.test(msg)) {
        existsCount++;
        rows.push({ name: emp.name, code: emp.code, status: 'exists' });
      } else {
        failedCount++;
        rows.push({ name: emp.name, code: emp.code, status: 'failed', error: msg });
      }
    }
  }

  return {
    status: failedCount > 0 && created === 0 && existsCount === 0 ? 'failed' : 'completed',
    created,
    exists: existsCount,
    failed: failedCount,
    rows,
  };
}

// ── Main Orchestrator ──

export interface XlsxLoadOptions {
  tenant_id: string;
  tenant_file?: string;
  boundary_file?: string;
  boundary_geojson_file?: string;
  masters_file?: string;
  employee_file?: string;
}

/**
 * Run xlsx-based tenant setup across all provided phases.
 * Phases execute in dependency order: Tenant → Boundaries → Masters → Employees.
 */
export async function loadFromXlsx(options: XlsxLoadOptions): Promise<XlsxLoadResult> {
  const { tenant_id, tenant_file, boundary_file, boundary_geojson_file, masters_file, employee_file } = options;

  const result: XlsxLoadResult = {
    success: true,
    tenant_id,
    phases: {},
  };

  let deptNameToCode: Map<string, string> | undefined;
  let desigNameToCode: Map<string, string> | undefined;
  let boundaryContext: BoundaryContext | undefined;

  // Phase 1: Tenant
  if (tenant_file) {
    try {
      result.phases.tenant = await runTenantPhase(tenant_id, tenant_file);
    } catch (error) {
      result.phases.tenant = {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // Phase 2: Boundaries
  if (boundary_file) {
    try {
      const boundaryResult = await runBoundaryPhase(tenant_id, boundary_file, undefined, boundary_geojson_file);
      boundaryContext = boundaryResult.context;
      const { context: _bctx, ...serializable } = boundaryResult;
      result.phases.boundaries = serializable;
    } catch (error) {
      result.phases.boundaries = {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // Phase 3: Masters
  if (masters_file) {
    try {
      const mastersResult = await runMastersPhase(tenant_id, masters_file);
      deptNameToCode = mastersResult.deptNameToCode;
      desigNameToCode = mastersResult.desigNameToCode;
      const { deptNameToCode: _d, desigNameToCode: _g, ...serializableResult } = mastersResult;
      result.phases.masters = serializableResult;
    } catch (error) {
      result.phases.masters = {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // Phase 4: Employees
  if (employee_file) {
    try {
      result.phases.employees = await runEmployeePhase(
        tenant_id, employee_file, deptNameToCode, desigNameToCode, boundaryContext,
      );
    } catch (error) {
      result.phases.employees = {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // Set overall success based on phase results
  const phaseResults = Object.values(result.phases);
  result.success = phaseResults.length > 0 && phaseResults.every((p) => p.status !== 'failed');

  return result;
}
