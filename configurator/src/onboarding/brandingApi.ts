import { apiClient, ENDPOINTS, mdmsService, MDMS_SCHEMAS } from '@/api';
import type { MdmsRecord } from '@/api/types';
import { BRAND_THEMES, type BrandTheme } from './brandThemes';

const THEME_SCHEMA = 'common-masters.ThemeConfig';
/** The uid a first ThemeConfig gets. Picking another theme later rewrites this record in place. */
const THEME_UID = 'themeconfig';

/**
 * The workspace's branding as the citizen and employee apps read it: the
 * tenant record's name and `logoId` (the header draws `logoId` as an image, so
 * it must be a URL), and the state root's ThemeConfig, which the apps apply at
 * start-up.
 */
export interface Branding {
  tenantId: string;
  tenantRecord: MdmsRecord;
  themeRecord: MdmsRecord | null;
  name: string;
  logoUrl: string | null;
  /** The brand theme the saved ThemeConfig matches, if it matches one. */
  themeId: string | null;
}

export type LogoChange = { kind: 'upload'; file: File } | { kind: 'remove' } | null;

/**
 * The name and logo saved but the theme did not. `saved` is the branding as it
 * now stands, so a retry writes only the theme instead of uploading the logo
 * again.
 */
export class ThemeSaveError extends Error {
  readonly saved: Branding;
  readonly cause: unknown;

  constructor(saved: Branding, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'ThemeSaveError';
    this.saved = saved;
    this.cause = cause;
  }
}

const stateRootOf = (tenantId: string) => tenantId.split('.')[0];

/** Colour sets compared regardless of key order. */
function sameColors(a: unknown, b: unknown): boolean {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.keys(value as Record<string, unknown>)
          .sort()
          .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
      );
    }
    return value;
  };
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

export function matchBrandTheme(record: MdmsRecord | null): string | null {
  if (!record) return null;
  const data = record.data as { name?: unknown; colors?: unknown };
  return (
    BRAND_THEMES.find((theme) => theme.label === data.name)?.id ??
    BRAND_THEMES.find((theme) => sameColors(theme.colors, data.colors))?.id ??
    null
  );
}

export async function loadBranding(tenantId: string): Promise<Branding> {
  const stateRoot = stateRootOf(tenantId);
  const [tenants, themes] = await Promise.all([
    // A city's record lives at its state root; mdms-v2 resolves up the tree, so
    // searching at the tenant itself finds it either way.
    mdmsService.searchRecords(tenantId, MDMS_SCHEMAS.TENANT),
    mdmsService.searchRecords(stateRoot, THEME_SCHEMA).catch(() => [] as MdmsRecord[]),
  ]);
  const tenantRecord = tenants.find((record) => record.uniqueIdentifier === tenantId && record.isActive !== false);
  if (!tenantRecord) {
    throw new Error(`The workspace ${tenantId} has no tenant record to brand.`);
  }
  // Only a record owned by the state root is ours to rewrite; an inherited one
  // belongs to a parent, and the apps take the first record they get.
  const themeRecord = themes.find((record) => record.tenantId === stateRoot && record.isActive !== false) ?? null;
  const data = tenantRecord.data as { name?: unknown; logoId?: unknown };

  return {
    tenantId,
    tenantRecord,
    themeRecord,
    name: typeof data.name === 'string' && data.name ? data.name : tenantId,
    logoUrl: typeof data.logoId === 'string' && data.logoId ? data.logoId : null,
    themeId: matchBrandTheme(themeRecord),
  };
}

/**
 * A lasting address for a stored file. filestore's /files/url answers with a
 * signed storage link that expires after a day, and the apps draw logoId
 * straight into an <img>, so the logo points at /files/id, which streams the
 * file by its id for as long as the file exists.
 */
function fileLink(tenantId: string, fileStoreId: string): string {
  const query = `tenantId=${encodeURIComponent(tenantId)}&fileStoreId=${encodeURIComponent(fileStoreId)}`;
  return `${apiClient.getEnvironment()}${ENDPOINTS.FILESTORE_FILE}?${query}`;
}

export async function saveBranding(
  current: Branding,
  changes: { name: string; logo: LogoChange; theme: BrandTheme | null },
): Promise<Branding> {
  const { tenantId, tenantRecord } = current;
  const stateRoot = stateRootOf(tenantId);
  const name = changes.name.trim();
  if (name !== current.name) throw new Error('Change the workspace name in Workspace settings.');
  // A rename may have completed while this form was open. Keep the current name.
  const fresh = await loadBranding(tenantId);
  const data: Record<string, unknown> = { ...fresh.tenantRecord.data };
  let logoUrl = current.logoUrl;

  if (changes.logo?.kind === 'upload') {
    const { fileStoreId } = await apiClient.uploadFile(changes.logo.file, 'branding');
    logoUrl = fileLink(tenantId, fileStoreId);
    data.logoId = logoUrl;
    data.imageId = fileStoreId;
  } else if (changes.logo?.kind === 'remove') {
    // logoId is optional but not nullable in tenant.tenants; imageId is nullable.
    delete data.logoId;
    data.imageId = null;
    logoUrl = null;
  }

  let tenantRecordAfter = tenantRecord;
  if (changes.logo) tenantRecordAfter = await mdmsService.update(fresh.tenantRecord, data);

  const savedSoFar: Branding = { ...current, tenantRecord: tenantRecordAfter, name, logoUrl };
  let themeRecord = current.themeRecord;
  if (changes.theme && changes.theme.id !== current.themeId) {
    const themeData = {
      ...(themeRecord?.data ?? {}),
      code: themeRecord?.uniqueIdentifier ?? THEME_UID,
      name: changes.theme.label,
      version: changes.theme.version,
      colors: changes.theme.colors,
    };
    try {
      themeRecord = themeRecord
        ? await mdmsService.update(themeRecord, themeData)
        : await mdmsService.create(stateRoot, THEME_SCHEMA, THEME_UID, themeData);
    } catch (err) {
      throw new ThemeSaveError(await loadBranding(tenantId).catch(() => savedSoFar), err);
    }
  }

  // Re-read rather than trust what the writes echoed: the next save needs each
  // record's current id and audit details, and a write may be accepted without
  // returning the record.
  return loadBranding(tenantId).catch(() => ({
    tenantId,
    tenantRecord: tenantRecordAfter,
    themeRecord,
    name,
    logoUrl,
    themeId: changes.theme?.id ?? current.themeId,
  }));
}
