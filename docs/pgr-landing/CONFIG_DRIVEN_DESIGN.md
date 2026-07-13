# Config-Driven Landing Page — Technical Design & Phased Plan

> Analysis-only deliverable. No code changes. Grounded in a 4-track codebase
> analysis (existing landing / configurator / MDMS+API / runtime renderer).
> File:line evidence throughout.

## 0. TL;DR decisions

| Decision | Choice | Why |
|---|---|---|
| **Storage** | New MDMS master **`RAINMAKER-PGR.LandingSection`** — **one row per section** — + optional singleton `RAINMAKER-PGR.LandingPageConfig` | Rides the existing generic MDMS CRUD; per-section enable/disable (`isActive`), order, draft/publish, and free `auditDetails`; avoids the array-in-one-record trap (the configurator's generic form **silently skips array/object fields**). Mirrors the proven `tenant.citymodule` shape. |
| **New master vs extend** | **New master**, not extending `uiHomePage`/`citymodule` | Landing sections are a distinct concern; `uiHomePage` is a single nested record that would force a bespoke editor + whole-doc last-write-wins. |
| **Config editing** | A bespoke **Landing Page Builder** custom editor mounted via the existing `customEditor` escape hatch | The escape hatch + `StateInfoEditor`/`ThemeConfigEditor` precedents make this zero-framework-change. |
| **i18n** | **Label-keys** (`PGR_LANDING_*`) in the row → localization master; never inline translated text | Reuses `useLandingCopy` + `LocalizationService` state+city overlay, already built. |
| **Theming** | `--pgrl-*-brand` CSS vars fed by `common-masters.ThemeConfig` via `applyTheme` | Zero new theming code; sections already defer to `--pgrl-*-brand`. |
| **Media** | Store **fileStoreIds**, resolve at render via `Filefetch`+`getFileUrl`+`getImgUrl` | Existing pipeline; configurator needs one new `ImageUploadInput` widget. |
| **Renderer** | **Registry-backed** `LandingRenderer`: `config.filter(enabled).sort(order).map(getComponent(type))` | Exactly the production `Home.js` module-card loop; replaces the hardcoded section list in `Landing/index.tsx`. |
| **Fetch** | Fold into `digitInitData` (anonymous, pre-login, public via Kong) + `useCustomMDMS` `idbTtlSecs` cache | The app already boots MDMS+localization anonymously before login. |
| **Draft/Publish/Version/Audit** | **Build by convention** — none exist natively | `status` field + preview override (v1); version + audit surfacing (later phase). |

---

## 1. Current state (what already exists)

### 1a. The built landing page (merged via PR #1158, `de775b2d`)
Self-contained 26-file bundle: `digit-ui-esbuild/products/pgr/src/pages/citizen/Landing/` + `docs/pgr-landing/`.
- **`index.tsx:109-124`** — 12 sections assembled in a **hardcoded order**: UtilityBar, LandingHeader, HeroSection, TypesSection, HowItWorksSection, ChannelsSection, PrivacySection, NewsSection, InstitutionsSection, FinalCtaSection, LandingFooter, WhatsAppFab.
- **Content sources (static):** `content.ts` (PT/EN copy deck `LANDING_COPY` ~120 keys + arrays `NAV_ITEMS`/`MANIFESTATION_TYPES`/`HOW_STEPS`/`CHANNELS`/`INSTITUTIONS`/`DEFAULT_NEWS`; **icons are lucide component refs = non-serializable**), `tokens.ts` (17 HSL design tokens + `buildTokenStyle`), `routes.ts` (17 named destinations).
- **Already partly pluggable:** `PGRLandingPageProps` (index.tsx:40-58) exposes `routes, news, heroImageUrl, emblemUrl, languages, onLanguageChange, tokens, showWhatsAppFab` — the *entire* current config surface; everything else is compiled in.
- **i18n already key-based** (`useLandingCopy.ts`: `t("PGR_LANDING_"+KEY)`) but **zero `PGR_LANDING_*` keys are seeded**.
- **Theming already defers** every `--pgrl-*` token to a `--pgrl-*-brand` `:root` override, but **nothing writes `--pgrl-*-brand`**.
- **Routing:** public, shell-free — `core/App.js` gates on `ComponentRegistryService.getComponent("PGRLandingPage")` and mounts `<Route exact path=/<contextPath>/landing>` outside `TopBarSideBar` (no `PrivateRoute`). `LandingLink` is router-optional.
- **No** enable/disable, ordering, draft/publish, preview, versioning, or audit anywhere.

> **Migration is mostly *wiring what's already there*:** seed the `PGR_LANDING_*` keys, write `--pgrl-*-brand`, and feed `PGRLandingPageProps` from config — then progressively promote each section's static array to config.

### 1b. Configurator (admin) building blocks
- **Custom-editor escape hatch (reuse wholesale):** `customEditors` map (`themeEditor/index.ts:14`) + `MdmsResourceEdit.tsx:76` + `descriptor.customEditor` (`types.ts:55`) + `schemaDescriptors/index.ts:11` + `resourceRegistry.ts:27` + auto-route `App.tsx:143` + auto-nav `DigitLayout.tsx:78`. A `LandingSectionsEditor` plugs in with **no framework change**.
- **Editor templates:** `ThemeConfigEditor` (descriptor→tabs, RHF, live preview via `useWatch`) and `StateInfoEditor` (bespoke, direct `mdmsUpdate`, add/remove-row tables — the reliable save path that dodges the flaky generic save).
- **Reusable widgets:** `ColorInput`, `BooleanInput` (visibility), `ChipArrayInput` (roles/tags), `LocaleListInput` (row tables), `DurationMsInput`, `RegexInput`, `JsonViewer`.
- **Filestore network layer done:** `DigitApiClient.filestoreUpload/filestoreGetUrl`; onboarding branding UX (`Phase1Page.tsx:292-863`, MIME/preview/replace) to extract into a widget.

### 1c. MDMS + API + runtime
- **Storage:** JSON-Schema "schema definition" + per-tenant "data" rows; seeded from DDH `schema/*.json` + `mdmsData/<module>/<code>.json` with `{tenantid}` placeholder.
- **API (reuse, no new code):** `DigitApiClient.mdmsSearch/mdmsCreate/mdmsUpdate` (`:189-216`); runtime `useCustomMDMS` mdmsv2 path with IndexedDB cache.
- **Renderer precedent:** `Digit.ComponentRegistryService` + `Home.js:118-131` (iterate config → `getComponent(key)` → render) — the exact pattern to reuse.
- **Anonymous boot:** `digitInitData` fetches MDMS+localization pre-login (`Request.js:52` sends `authToken:null`), so a public landing reads its config before login.

---

## 2. Data model & storage

### `RAINMAKER-PGR.LandingSection` (one row per section)
```jsonc
// draft-07; required:[code,type,order,enabled]; x-unique:[code];
// x-ref-schema:[]; additionalProperties:false
{
  "code":        "string",   // uid, e.g. "hero", "types", "news"
  "type":        "string",   // v1 catalog (registry/picker-enforced, NOT a schema enum): hero|navigation|types|steps|channels|privacy|news|institutions|cta|footer
  "order":       "number",   // explicit sort (MDMS returns unordered)
  "enabled":     "boolean",  // default true
  "status":      "string",   // DRAFT|PUBLISHED (runtime shows PUBLISHED only)
  "version":     "number",
  "roles":       ["string"], // optional role-gated section (renderer filters)
  "titleKey":    "string",   // PGR_LANDING_* localization keys (NOT inline text)
  "subtitleKey": "string",
  "bodyKey":     "string",
  "media":       { "imageId":"string(fileStoreId)", "altKey":"string" },
  "items":       [ { "code":"string", "labelKey":"string", "iconId":"string",
                     "navigationUrl":"string", "enabled":"boolean", "order":"number" } ],
  "theme":       { "accent":"string", "bg":"string" }   // token refs / hex
}
```
### `RAINMAKER-PGR.LandingPageConfig` (optional singleton, `code:"default"`)
`enabled, sectionOrder(string[] global override), defaultLocale, theme(tokens), seo{titleKey,descriptionKey}, publish{status,publishedVersion,publishedAt}`.

**Why one-row-per-section:** generic MDMS CRUD gives list/create/edit + soft enable/disable (`isActive`) + audit free; per-section reorder/edit/publish; no bespoke array widget required for basic CRUD. The **Builder** editor is a *view* over these rows (reorder via `order`, toggle via `enabled`, edit inline) — best of both.

### Icons problem
`content.ts` icons are lucide component refs (non-serializable). Config stores an **icon name string** (`iconId`); the renderer maps name→lucide component via a small allowlist map (also bounds which icons are usable — a security/consistency win).

---

## 3. API contracts (all existing — no new endpoints)
- **Search:** `POST /mdms-v2/v2/_search` `{MdmsCriteria:{tenantId, schemaCode:"RAINMAKER-PGR.LandingSection", limit:500}}` (no total count → page-full heuristic; keep counts modest).
- **Create:** `POST /mdms-v2/v2/_create/RAINMAKER-PGR.LandingSection` `{Mdms:{tenantId, schemaCode, uniqueIdentifier:code, data, isActive:true}}`.
- **Update / disable:** `POST /mdms-v2/v2/_update/...` (`isActive:false` = disable).
- **Schema register (once, state tenant):** `POST /mdms-v2/schema/v1/_create`.
- **Localization:** `DigitApiClient.localizationUpsert` for `PGR_LANDING_*` keys.

---

## 4. Rendering flow (runtime)
1. `StoreService.digitInitData` fetches `LandingSection` (+ `LandingPageConfig`) beside `uiHomePage`/`ThemeConfig`, anonymously, pre-login; cache via `useCustomMDMS` `idbTtlSecs:86400`.
2. `applyTheme` writes `--color-*`; extend `V3_EXPANSION` to also emit `--pgrl-*-brand` from `ThemeConfig`.
3. `<LandingRenderer>`:
   ```
   sections
     .filter(s => s.enabled !== false && s.status === "PUBLISHED" && rolesOk(s))
     .sort((a,b) => a.order - b.order)
     .map(s => { const C = Digit.ComponentRegistryService.getComponent(s.type);
                 return C ? <C key={s.code} config={s} /> : null; })
   ```
4. Each section component: copy = `t(labelKey)`; colors = `var(--pgrl-*/--color-*)`; images = `Filefetch(imageId)`→`getFileUrl`→`getImgUrl` (async → placeholder).
5. Mounted on the existing shell-free public `Route`.

---

## 5. Component / folder structure
```
digit-ui-esbuild/products/pgr/src/pages/citizen/Landing/
  index.tsx                 → thin wrapper; delegates to LandingRenderer
  LandingRenderer.tsx       (NEW) registry loop + role/enabled/order filter
  sectionRegistry.ts        (NEW) type -> component + iconId -> lucide map
  components/…               existing section comps: accept `config` prop, read t()/vars/fileStoreIds
  useLandingConfig.ts       (NEW) useCustomMDMS fetch + state+city overlay merge
configurator/src/admin/landingEditor/
  LandingSectionsEditor.tsx (NEW) builder: list rows, reorder, toggle, edit, preview, publish
  ImageUploadInput.tsx      (NEW) RHF media widget (wraps filestoreUpload + Phase1 UX)
  LandingPreview.tsx        (NEW) useWatch live preview (à la ThemePreview)
configurator/src/admin/schemaDescriptors/landing-section.ts  (NEW) groups+widgets, customEditor:'landing-sections'
utilities/default-data-handler/src/main/resources/
  schema/rainmaker-pgr-landing.json          (NEW) LandingSection + LandingPageConfig schema seed (auto-globbed by schema/*.json)
  mdmsData-dev/RAINMAKER-PGR/RAINMAKER-PGR.LandingSection.json     (NEW) 10 default PUBLISHED rows
  mdmsData-dev/RAINMAKER-PGR/RAINMAKER-PGR.LandingPageConfig.json  (NEW) code=default singleton
  localisations/{en_IN,pt_PT}/rainmaker-pgr.json           (+104 PGR_LANDING_* keys/locale)
```

---

## 6. Gaps to BUILD (not reusable today)
| Gap | Effort | Approach |
|---|---|---|
| Image-upload **form widget** | small | `ImageUploadInput` wrapping `filestoreUpload` + Phase1 validation/preview |
| Section **reordering** | small→med | v1 = numeric `order` + up/down; optional `@dnd-kit` for true drag |
| **Draft/Publish/Preview** | medium | `status` field + `?preview` override; v1 avoids two-record pipeline |
| **Version history / rollback** | medium | version-suffixed uids or `version` field; later phase |
| **Audit log surfacing** | trivial | render existing `auditDetails` in Show (quick win) |
| **Rich text** | opt | only if copy needs formatting; else textarea + escaping |
| **Publish role gating** | small | gate Publish action on `state.user.roles` (UI is permissive today) |
| Runtime **state+city overlay** for this master | small | implement in fetch (follow `getLocale` precedent; none built-in) |

---

## 7. Constraints & gotchas (must design around)
- Generic configurator form **skips array/object fields** (`MdmsResourceCreate.tsx:85`) → items/theme need the custom editor or new widgets.
- `additionalProperties:false` rejects stray fields → declare every nested field; dataProvider strips `id/_*`.
- **`x-ref-schema {}→[]` quirk** → ship `[]`, expect possible create-time strip / DB patch; **schema `_update` is 501 — get the schema right the first time.**
- **Omit empty nested arrays** in seed rows (empty `items:[]` can throw everit JSONArray/JSONObject on some stacks).
- MDMS `_search` has **no total count** → limit 500, modest section counts.
- **No native draft/version** → convention (status/version/isActive) + `auditDetails` for who/when.
- Runtime init fetches at **state tenant**; **no built-in state+city overlay** for non-localization masters → build the merge (city wins by `code`).
- **`.v2-scope` descendant-scoping**: wrapper carries `v2-scope`, inner gets utilities — sections must respect nesting or render unstyled.
- **`overrides.css` anchor rule** repaints any `<a>` tenant-blue (specificity 0-2-1) → section links need Tailwind `!` text-color modifiers (a browser harness won't catch this).
- **Filefetch returns signed, time-limited URLs** → resolve `fileStoreId`→url at render with a placeholder; naive `<img src={id}>` fails.
- `getDataByCriteria` caches `cacheTime=0` under `getMultiRootTenant()` (mz) → use the `idbTtlSecs` path / in-memory cache.
- **Redeploys wipe live schemas/tenants** → the landing schema + default rows MUST ship via DDH seeds, not just created live.
- **DDH seed-path reality (verified):** the PGR module's data seeds live under `mdmsData-dev/**`, which DDH loads **only** via a boot-time `@Scheduled` initializer (gated on `dev.enabled=true`) onto the single baked tenant `statea`. **Neither `/tenant/new` (`loadNewTenantProductionData` → production `mdmsData/**` only) nor `/defaultdata/setup` loads the dev path.** So a real/onboarded tenant is NOT auto-seeded with the landing rows through DDH. Real-tenant rollout = a **migration seed script** (register the 2 schemas + create rows + `_upsert` the `PGR_LANDING_*` keys onto the target tenant via MDMS v2 API), exactly as the rest of the PGR feature (hierarchy/extended-attributes) is deployed. The DDH files are the versioned source-of-truth/reference; the script is the delivery mechanism.
- **XSS:** config is admin/tenant-authored = untrusted. Any HTML/rich-text section must escape (the `GeoLocations` `bindTooltip` escaper) — **do not** copy the existing `dangerouslySetInnerHTML` sites.

---

## 8. Performance / caching / security
- **Caching:** config + localization + theme via `idbTtlSecs` IndexedDB (survives reloads, per-tenant keyed); fold into `digitInitData` to avoid a loader flash pre-login.
- **Bundle:** enable/disable does **not** tree-shake — all registered section components ship. True splitting needs `React.lazy` per type (registry is synchronous today); acceptable for v1.
- **Images:** store fileStoreIds, size assets sanely (the login-bg lesson: cap heights, `object-fit`).
- **Anonymous exposure:** config + its localization + referenced images must be **publicly readable through Kong** for logged-out visitors; **role-gated sections must be filtered in the renderer** (their mere presence in config leaks to anon).
- **Security:** escape/sanitize any rich text; icon allowlist; validate media is a fileStoreId not an arbitrary URL where possible.

---

## 9. Phased plan (each phase independently shippable, backward-compatible)

**Phase 0 — Foundations (schema + seed + keys), no UI**
- Author `RAINMAKER-PGR.LandingSection` (+ `LandingPageConfig`) schema; register via DDH `schema/*.json` (mind x-ref-schema). Seed default rows (`{tenantid}`) matching today's 12 sections. Seed `PGR_LANDING_*` localization keys (en+pt) from the existing `LANDING_COPY` deck. **Outcome:** config exists; page unchanged.

**Phase 1 — Runtime renderer (read-path)**
- Register each section component in `Module.js` `componentsToRegister`. Add `sectionRegistry.ts` (type→component, iconId→icon). Add `useLandingConfig.ts` (fetch + state+city overlay). Replace `index.tsx`'s hardcoded list with `<LandingRenderer>` driven by config (enabled/order/role/status filter). Fall back to `DEFAULT_*` when config absent (backward compat). **Outcome:** page renders from config; editing rows in MDMS changes the page.

**Phase 2 — Theming + media wired**
- Extend `applyTheme` `V3_EXPANSION` to emit `--pgrl-*-brand` from `ThemeConfig`. Resolve `media.imageId` via `Filefetch`/`getFileUrl`. **Outcome:** per-tenant theme + images from config.

**Phase 3 — Configurator: read/CRUD**
- Add `landing-sections` resource to `resourceRegistry.ts` (auto List/Show/Edit/Create) + a `schemaDescriptor` (groups: Identity/Content/Media/Items/Theme/Publish; widgets: ChipArray roles, Color theme, LocaleList-style items). Surface `auditDetails` in Show (quick audit win). **Outcome:** admins CRUD sections generically.

**Phase 4 — Configurator: the Builder editor**
- `LandingSectionsEditor` (customEditor) — lists rows, reorder (numeric up/down v1), enable/disable, inline edit, live preview (`useWatch`). New `ImageUploadInput` widget. **Outcome:** the mockup's "Landing Page Builder" UX.

**Phase 5 — Draft/Publish/Preview**
- `status` (DRAFT|PUBLISHED); runtime shows PUBLISHED; `?preview=1` (authed) shows drafts; Publish action gated on `state.user.roles`. **Outcome:** safe editing with preview.

**Phase 6 — Version history / rollback + richer widgets (optional)**
- Version-suffixed uids or `version` + a restore action; `@dnd-kit` drag reorder; rich-text (escaped) only if needed. **Outcome:** full lifecycle.

**Cross-tenant:** every phase seeds per-tenant via DDH; city rows override state by `code`.

### Phase → decision mapping (locked)
- **P0** schema `status` field baked in from the start (D2); `type` is a documented **string** (NOT a schema enum) — the v1 catalog is enforced by the renderer registry + Configurator picker (D4), so P2+ can add types without a schema recreation; no new role to seed — publish/edit gate on the existing `ADMIN` role (D3). *(Shipped: PR #1186 — schema + DDH seeds + 104 `PGR_LANDING_*` keys/locale.)*
- **P1/P2** plain-text keys + fileStoreIds + `--pgrl-*-brand` (D1, no HTML render).
- **P4** Builder editor + `ImageUploadInput`; **no** rich-text widget (D1).
- **P5** Draft→Preview→Publish + `ADMIN` gating (D2, D3). **No** version history here.
- **P6** version history/rollback + `React.lazy` splitting + optional Markdown-subset — all deferred (D2, D5, D1).

---

## 10. LOCKED decisions (product sign-off received)
1. **Text:** localized **plain text only (v1)**. No rich text / raw HTML. If formatting is needed later → a small **Markdown subset** (sanitized), not HTML. → schema uses `*Key` localization keys; no HTML render path; the XSS surface stays closed.
2. **Lifecycle:** **Draft → Preview → Publish (v1)**. `status: DRAFT|PUBLISHED`; runtime renders PUBLISHED only; authed `?preview=1` renders drafts. **Version history / rollback = Phase 2** (deferred).
3. **Permission:** use the **existing `ADMIN` role** (no new `LANDING_ADMIN`). Configurator gates the Publish action + landing edit routes on `ADMIN` (+ `SUPERUSER` implicitly). **No new role or role-actions to seed** — backend RBAC on `_update` (already enforced for MDMS masters) is the real gate; UI gating is UX. Revisit a dedicated role only if landing management must be delegated separately from MDMS admin later.
4. **Section `type` = v1 catalog, no Custom HTML.** Catalog (scope A, the sections that actually exist today): `hero, navigation, types, steps, channels, privacy, news, institutions, cta, footer`. **The schema does NOT enum-lock `type`** — it is a documented free string, and the catalog is enforced by the runtime `sectionRegistry` + the Configurator type picker. Rationale: MDMS schema `_update` is unsupported (501), so an enum would make adding a type later require a painful schema recreation; a registry keeps the renderer generic and the catalog extensible without schema surgery (per the scope-A guardrail). **Explicitly excluded from v1 (Phase 2 redesign, not config-framework work):** Statistics, FAQ, standalone Banner, Testimonials, Marketing sections, and any "Custom Component" plugin.
5. **Bundle:** ship all sections in **one bundle (v1)**; `React.lazy` per-section is a Phase-2 option (config model unaffected).

### 10a. ⚠️ Enum ↔ built-sections reconciliation (needs one confirmation)
The frozen v1 enum (from the mockup) does **not** 1:1 match the 12 sections actually built in `Landing/` today:

| Frozen v1 type | Built component today | Status |
|---|---|---|
| `hero` | `HeroSection` | ✅ exists |
| `navigation` | `LandingHeader` (+ `UtilityBar`) | ✅ exists |
| `services` | `TypesSection` (manifestation types) | ✅ exists (rename/verb) |
| `features` | `HowItWorksSection` (steps) / channel cards | ✅ exists (map) |
| `news` | `NewsSection` | ✅ exists |
| `footer` | `LandingFooter` | ✅ exists |
| `banner` | Hero background image | ⚠️ partial (no standalone banner section) |
| `statistics` | — | ❌ **net-new component** |
| `faq` | — | ❌ **net-new component** |
| Built but not in enum: `ChannelsSection`, `PrivacySection`, `InstitutionsSection`, `WhatsAppFab` | exist | ❓ map into enum, keep as extra frozen types, or drop in v1 |

**DECISION: scope A (LOCKED)** — v1 makes the **existing** built sections config-driven. Net-new Statistics / FAQ / standalone-Banner are **deferred** (out of v1).

**Frozen v1 `type` enum (scope A):**
```
hero | navigation | types | steps | channels | privacy | news | institutions | cta | footer
```
- `navigation` = `LandingHeader` (sticky nav). The **`UtilityBar`** (utility strip) is a **page-config toggle** (`LandingPageConfig.showUtilityBar`), not a section row.
- **`whatsapp-fab`** is a **page-config toggle** (`LandingPageConfig.showWhatsAppFab`), not a section row.
- `types` = manifestation types (built `TypesSection`); `steps` = built `HowItWorksSection`; `cta` = built `FinalCtaSection`.
- **Deferred (Phase 2 redesign, net-new components):** `statistics`, `faq`, standalone `banner`, `testimonials`, marketing sections, and any "custom-component" plugin.

This catalog is the single source of truth for the runtime `sectionRegistry` **and** the Configurator type picker (the schema `type` is an unconstrained string — see D4 — so nothing to keep in lockstep at the schema layer). Utility Bar + WhatsApp FAB are page-level toggles, not types.
