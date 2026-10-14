/**
 * ours (cfgreview F12 / PM 5, #1558): "what does this role let someone see at this tenant", before anyone holds it.
 * One read-only call to pgr-services' role preview (POST /pgr-services/v2/access/_preview, #1651): OPA's filter for a
 * would-be holder, pgr's own count under it, and up to 3 sample complaints with the role's and the caller's masks.
 */
export const PREVIEW_PATH = '/pgr-services/v2/access/_preview';

export interface PreviewSample {
  serviceRequestId: string; tenantId?: string; serviceCode?: string; applicationStatus?: string; locality?: string;
  createdTime?: number; citizen?: { name?: string; mobileNumber?: string; emailId?: string }; maskedForRole?: string[];
}
export interface PreviewAnswer {
  tenantId: string; role: { code: string; tenantId: string }; areas?: string[]; departments?: string[];
  filter?: { tenant_wide?: boolean; any_of?: unknown[] }; count: number; total: number; samples: PreviewSample[];
}

/** The request: the role granted at the tenant, with the areas (boundary codes) the would-be holder covers. */
export function previewBody(input: { tenantId: string; role: string; areas: string[] }, requestInfo: Record<string, unknown>) {
  const areas = [...new Set(input.areas.map((a) => a.trim()).filter(Boolean))].slice(0, 50);
  return { RequestInfo: requestInfo, tenantId: input.tenantId, role: input.role, ...(areas.length ? { areas } : {}) };
}

/** The answer in one sentence. */
export function previewSentence(a: PreviewAnswer): string {
  const of = `${a.count} of the ${a.total} complaint${a.total === 1 ? '' : 's'} at ${a.tenantId}`;
  if (a.filter?.tenant_wide) return `Someone with ${a.role.code} here would see every complaint at ${a.tenantId}: ${of}.`;
  if (a.count === 0 && !(a.areas ?? []).length) return `Someone with ${a.role.code} here would see ${of}. The role is limited to the areas its holder covers: add areas to preview them.`;
  return `Someone with ${a.role.code} here would see ${of}${(a.areas ?? []).length ? ` (areas ${a.areas!.join(', ')})` : ''}.`;
}

/** The refusals the API answers, in words. */
export function previewError(message: string): string {
  if (/ACCESS_PREVIEW_RATE_LIMITED|429/.test(message)) return 'Too many previews in a minute; try again shortly.';
  if (/ACCESS_PREVIEW_NEEDS_OPA|503/.test(message)) return 'The preview needs the access engine (OPA), which is not running on this installation.';
  if (/403|NOT_AN_ADMIN|Forbidden|AccessDenied/i.test(message)) return `The server refused the preview (${message.slice(0, 80)}): only an administrator at this tenant or above may preview a role here.`;
  const invalid = /ACCESS_PREVIEW_INVALID_([A-Z_]+)/.exec(message);
  if (invalid) return `The preview refused the ${invalid[1].toLowerCase().replace(/_/g, ' ')}.`;
  return message;
}
