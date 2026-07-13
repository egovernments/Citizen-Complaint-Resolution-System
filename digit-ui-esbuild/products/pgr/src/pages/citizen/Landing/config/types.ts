// Runtime config model for the config-driven landing page (P1, CCSD-2006).
//
// These interfaces mirror the two MDMS masters shipped in Phase 0
// (RAINMAKER-PGR.LandingSection + RAINMAKER-PGR.LandingPageConfig, see
// utilities/default-data-handler/.../schema/rainmaker-pgr-landing.json). MDMS is
// untrusted, tenant-authored input, so every field is optional here and the
// renderer defends against missing/garbage values (see useLandingConfig +
// sectionRegistry). Text is carried as PGR_LANDING_* localization *keys*, never
// inline strings — resolved through useLandingCopy (store, then bundled deck).

/** The frozen v1 section catalog (scope A). Enforced here + in the registry,
 *  NOT by the MDMS schema (type is a free string there so new types can be
 *  added without a schema recreation). */
export type LandingSectionType =
  | "hero"
  | "navigation"
  | "types"
  | "steps"
  | "channels"
  | "privacy"
  | "news"
  | "institutions"
  | "cta"
  | "footer";

export type LandingStatus = "DRAFT" | "PUBLISHED";

/** One card / link / step inside a section. Matches the MDMS items[] schema
 *  (additionalProperties:false: code/labelKey/descKey/iconId/navigationUrl/
 *  enabled/order). Cosmetic-only fields the schema can't express (accent,
 *  external, badge, icon component) are inherited from the matching default
 *  item by `code` during resolution. */
export interface LandingItemConfig {
  code?: string;
  labelKey?: string;
  descKey?: string;
  iconId?: string;
  navigationUrl?: string;
  enabled?: boolean;
  order?: number;
}

export interface LandingMediaConfig {
  imageId?: string;
  altKey?: string;
}

export interface LandingSectionConfig {
  code?: string;
  type?: string;
  order?: number;
  enabled?: boolean;
  status?: LandingStatus;
  version?: number;
  /** When non-empty, only users holding one of these roles see the section.
   *  Empty/absent => public (the common case for this pre-login page). */
  roles?: string[];
  titleKey?: string;
  subtitleKey?: string;
  bodyKey?: string;
  media?: LandingMediaConfig;
  items?: LandingItemConfig[];
  theme?: { accent?: string; bg?: string };
}

export interface LandingPageConfig {
  code?: string;
  enabled?: boolean;
  defaultLocale?: string;
  showWhatsAppFab?: boolean;
  showUtilityBar?: boolean;
  /** Optional global order override (list of section codes). When present it
   *  wins over each section's numeric `order`. */
  sectionOrder?: string[];
  seo?: { titleKey?: string; descriptionKey?: string };
  theme?: Record<string, string>;
  publish?: { status?: string; publishedVersion?: number; publishedAt?: number };
}

/** The fully-resolved config the renderer consumes: a page config plus the
 *  ordered, enabled, role-filtered list of sections. Produced by
 *  useLandingConfig from MDMS, or from DEFAULT_LANDING_CONFIG on
 *  missing/incomplete data. */
export interface ResolvedLandingConfig {
  page: LandingPageConfig;
  sections: LandingSectionConfig[];
}
