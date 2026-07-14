// Pure resolution helpers for the config-driven landing (P1, CCSD-2006).
//
// MDMS config is untrusted, tenant-authored input, so everything here is
// defensive: bad types are ignored, unsafe URLs are neutralised, unknown
// section types are dropped by the caller, and every path has a sane default.

import { resolveIcon } from "./iconRegistry";
import type { IconComponent } from "../content";
import type { LandingItemConfig, LandingSectionConfig } from "./types";

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

/** Allow only in-app ("/", "#"), http(s), tel and mailto/wa targets. Anything
 *  else (javascript:, data:, vbscript: …) collapses to the inert "#". */
export function safeHref(url?: string): string {
  if (!url || typeof url !== "string") return "#";
  const u = url.trim();
  if (u === "#" || u.startsWith("/") || u.startsWith("#")) return u;
  if (/^(https?:|tel:|mailto:|wa:)/i.test(u)) return u;
  // wa.me / plain domain without scheme -> treat cautiously as external https
  if (/^wa\.me\//i.test(u) || /^www\./i.test(u)) return "https://" + u;
  return "#";
}

/** A LandingRoutes key (resolved against the routes map) OR a literal URL. */
export function resolveNavTarget(
  navigationUrl: string | undefined,
  routes: Record<string, string>,
  fallbackRouteKey?: string
): { route?: string; href?: string } {
  if (navigationUrl && Object.prototype.hasOwnProperty.call(routes, navigationUrl)) {
    return { route: navigationUrl };
  }
  if (navigationUrl) return { href: safeHref(navigationUrl) };
  if (fallbackRouteKey) return { route: fallbackRouteKey };
  return { href: "#" };
}

// ---------------------------------------------------------------------------
// Items — build the rich runtime shape section components iterate
// ---------------------------------------------------------------------------

/** Rich item: superset of every default-array element shape (content.ts).
 *  Cosmetic-only fields absent from the MDMS item schema (accentVar, external,
 *  badgeKey, ctaKey) are inherited from the matching default by `code`. */
export interface RichItem {
  id?: string;
  code?: string;
  icon?: IconComponent;
  labelKey?: string;
  titleKey?: string;
  descKey?: string;
  ctaKey?: string;
  badgeKey?: string;
  accentVar?: string;
  external?: boolean;
  route?: string;
  href?: string;
  order?: number;
}

const defaultKey = (d: any): string | undefined => d?.id ?? d?.code ?? d?.labelKey;

/** Build the runtime item list. When `rawItems` is empty/absent the caller uses
 *  its built-in default array instead (see section components) — so an
 *  unconfigured section is byte-identical to today. When present, each config
 *  item is normalised: icon string -> component, nav target -> route-key|url,
 *  and cosmetic fields inherited from the default of the same `code`. */
export function buildRichItems(
  rawItems: LandingItemConfig[] | undefined,
  defaultArray: any[],
  routes: Record<string, string>
): RichItem[] | undefined {
  if (!Array.isArray(rawItems) || rawItems.length === 0) return undefined;
  const byKey = new Map<string, any>();
  (defaultArray || []).forEach((d) => {
    const k = defaultKey(d);
    if (k) byKey.set(k, d);
  });

  const items = rawItems
    .filter((it) => it && it.enabled !== false)
    .map((it, i): RichItem => {
      const base = (it.code && byKey.get(it.code)) || {};
      const target = resolveNavTarget(it.navigationUrl, routes, base.route);
      return {
        id: it.code ?? base.id ?? `item-${i}`,
        code: it.code,
        icon: resolveIcon(it.iconId, base.icon),
        // Key-based sections read titleKey/labelKey/descKey through c().
        labelKey: it.labelKey ?? base.labelKey,
        titleKey: it.labelKey ?? base.titleKey,
        descKey: it.descKey ?? base.descKey,
        ctaKey: base.ctaKey,
        badgeKey: base.badgeKey,
        accentVar: base.accentVar ?? "--pgrl-primary",
        external: base.external,
        route: target.route,
        href: target.href,
        order: typeof it.order === "number" ? it.order : i,
      };
    });

  items.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return items;
}

// ---------------------------------------------------------------------------
// Sections — order, visibility, role-gating, tenant overlay
// ---------------------------------------------------------------------------

/** City rows override state rows by `code` (tenant override). Rows without a
 *  code fall through unchanged. */
export function mergeSectionsByCode(
  stateRows: LandingSectionConfig[],
  cityRows: LandingSectionConfig[]
): LandingSectionConfig[] {
  if (!cityRows || cityRows.length === 0) return stateRows || [];
  const merged = new Map<string, LandingSectionConfig>();
  (stateRows || []).forEach((r, i) => merged.set(r.code ?? `s-${i}`, r));
  cityRows.forEach((r, i) => merged.set(r.code ?? `c-${i}`, r));
  return Array.from(merged.values());
}

/** A section is visible when: enabled !== false, not DRAFT (unless preview),
 *  and either public (no roles) or the user holds one of its roles. */
export function isSectionVisible(
  s: LandingSectionConfig,
  userRoles: string[],
  opts: { preview?: boolean } = {}
): boolean {
  if (!s || s.enabled === false) return false;
  if (!opts.preview && s.status === "DRAFT") return false;
  if (Array.isArray(s.roles) && s.roles.length > 0) {
    const set = new Set(userRoles || []);
    if (!s.roles.some((r) => set.has(r))) return false;
  }
  return true;
}

/** Order sections: an explicit page.sectionOrder (list of codes) wins; else the
 *  numeric `order`; ties keep input order. Filters to visible sections first. */
export function orderSections(
  sections: LandingSectionConfig[],
  sectionOrder: string[] | undefined,
  userRoles: string[],
  opts: { preview?: boolean } = {}
): LandingSectionConfig[] {
  const visible = (sections || []).filter((s) => isSectionVisible(s, userRoles, opts));
  if (Array.isArray(sectionOrder) && sectionOrder.length > 0) {
    const rank = new Map(sectionOrder.map((code, i) => [code, i]));
    return visible
      .slice()
      .sort((a, b) => {
        const ra = rank.has(a.code!) ? rank.get(a.code!)! : Number.MAX_SAFE_INTEGER;
        const rb = rank.has(b.code!) ? rank.get(b.code!)! : Number.MAX_SAFE_INTEGER;
        if (ra !== rb) return ra - rb;
        return (a.order ?? 0) - (b.order ?? 0);
      });
  }
  return visible.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}
