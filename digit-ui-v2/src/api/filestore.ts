/**
 * Filestore helpers shared by the citizen UI surfaces (profile photo,
 * complaint photos). The `_url` endpoint returns one of two shapes depending
 * on the egov-filestore version on the cluster — both are handled here.
 */
import { apiClient, getApiBaseUrl } from '@/api';
import { ENDPOINTS } from '@/api/config';

const STATE_TENANT = (import.meta.env.VITE_CITIZEN_STATE_TENANT as string) || 'ke';

/** Upload a single file and return its fileStoreId. */
export async function uploadFile(
  file: File,
  module: string,
  opts: { tag?: string; tenantId?: string } = {},
): Promise<string> {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('tenantId', opts.tenantId ?? STATE_TENANT);
  fd.append('module', module);
  if (opts.tag) fd.append('tag', opts.tag);

  const { token } = apiClient.getAuth();
  const res = await fetch(`${getApiBaseUrl()}${ENDPOINTS.FILESTORE_UPLOAD}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: fd,
  });
  if (!res.ok) throw new Error(`Filestore upload failed: HTTP ${res.status}`);
  const data = (await res.json()) as { files?: Array<{ fileStoreId: string }> };
  const id = data.files?.[0]?.fileStoreId;
  if (!id) throw new Error('Filestore upload returned no fileStoreId.');
  return id;
}

/** Resolve fileStoreIds → CDN/signed URLs. Returns empty map on failure. */
export async function fetchFileUrls(
  fileStoreIds: string[],
  opts: { tenantId?: string } = {},
): Promise<Record<string, string>> {
  if (fileStoreIds.length === 0) return {};
  const { token } = apiClient.getAuth();
  const qs = new URLSearchParams({
    tenantId: opts.tenantId ?? STATE_TENANT,
    fileStoreIds: fileStoreIds.join(','),
  });
  const res = await fetch(`${getApiBaseUrl()}${ENDPOINTS.FILESTORE_URL}?${qs.toString()}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) return {};
  const data = await res.json();
  if (Array.isArray(data.fileStoreIds) && Array.isArray(data.urlList)) {
    const map: Record<string, string> = {};
    data.fileStoreIds.forEach((id: string, i: number) => {
      map[id] = data.urlList[i];
    });
    return map;
  }
  if (data.fileStoreUrls && typeof data.fileStoreUrls === 'object') {
    return data.fileStoreUrls as Record<string, string>;
  }
  return {};
}

/** Single-id convenience over fetchFileUrls. Returns '' if missing. */
export async function fetchFileUrl(
  fileStoreId: string,
  opts: { tenantId?: string } = {},
): Promise<string> {
  if (!fileStoreId) return '';
  const map = await fetchFileUrls([fileStoreId], opts);
  return map[fileStoreId] ?? '';
}
