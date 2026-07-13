# PGR Public Landing Page

Self-contained public Home/Landing page for the Complaints & Reports Portal
(Portal de Reclamações e Denúncias). It routes citizens into the **existing**
application — it implements no internal pages, no auth, no APIs.

Full design rationale, UX/UI audit and accessibility report:
[`docs/pgr-landing/LANDING_PAGE_REDESIGN.md`](../../../../../../docs/pgr-landing/LANDING_PAGE_REDESIGN.md).

## Quick start (this repo)

The folder already sits inside the Tailwind content glob
(`products/pgr/src/pages/citizen/**`) — **no build config changes needed**.

Register the page as a *public* route (plain `Route`, not `PrivateRoute`).

**Important — mount it shell-free.** The page is a complete standalone landing
(own header, nav, footer). The regular citizen routes render inside the app
shell (fixed `.topbar` at `z-index:9999`, sidebar, centered container), which
would produce a page-within-a-page. Two supported options:

1. **Dedicated shell-free route (recommended)** — register the route in
   `packages/modules/core/src/pages/citizen/index.js` *outside* the
   TopBarSideBar-wrapped switch (alongside the top-level routes), e.g.:

   ```jsx
   import PGRLandingPage from "@egovernments/digit-ui-module-pgr/pages/citizen/Landing";
   <Route exact path={`${path}/pgr-landing`}>
     <PGRLandingPage />
   </Route>
   ```

2. **Inside the shell** (if you must): set the sticky-nav offset so the
   landing nav pins *below* the app topbar instead of underneath it:

   ```jsx
   <div style={{ "--pgrl-nav-offset": "82px" }}>
     <PGRLandingPage />
   </div>
   ```

Two behaviors to decide consciously:

- `REGISTER_COMPLAINT` / `TRACK_COMPLAINT` are `PrivateRoute`s — anonymous
  visitors get bounced to login by the existing app (usually the desired
  funnel; otherwise point the routes at a public entry).
- The default language switcher calls `i18n.changeLanguage` only. In-app,
  pass `onLanguageChange` wired to `Digit.LocalizationService.changeLanguage`
  so locale persistence + MDMS bundle loading behave like the rest of the app.

## Quick start (any React app)

```jsx
import PGRLandingPage from ".../Landing";

<PGRLandingPage
  routes={{
    REGISTER_COMPLAINT: "/citizen/pgr/create-complaint",
    TRACK_COMPLAINT: "/citizen/pgr/complaints",
    PRIVACY: "https://example.gov.mz/privacidade",
  }}
/>
```

Requirements: React 17+, `react-i18next` (any configured instance — the page
works with zero translations seeded), and the compiled Tailwind CSS from
`packages/digit-ui-components-v2/src/theme/tailwind.css`. A react-router v5
`<Router>` above the page is **optional**: with one, internal links use
`history.push`; without one, they degrade to plain anchors.

> Deployment note: when the app is served under a basename (e.g. `/digit-ui`),
> mount the page inside the app's Router so pushes resolve against the
> basename. Only fully standalone hosting (no Router) needs absolute paths in
> the route map.

## Configuration surface (`PGRLandingPageProps`)

| Prop | Default | Purpose |
| --- | --- | --- |
| `routes` | `DEFAULT_LANDING_ROUTES` | Destination map — every CTA resolves through it. `"#"` renders a disabled control instead of a dead link. |
| `news` | `DEFAULT_NEWS` | Updates-grid cards (pass CMS content in production). |
| `heroImageUrl` | none | Optional hero photo, rendered under a green scrim (contrast-safe). |
| `emblemUrl` | none | Government emblem in the masthead (falls back to a glyph). |
| `languages` | PT / EN | Language switcher options (`{ code, label }`). |
| `onLanguageChange` | `i18n.changeLanguage` | Override for DIGIT locale switching (e.g. re-fetch MDMS bundles). |
| `tokens` | Mozambique palette | Design-token overrides (HSL triples — see `tokens.ts`). |
| `showWhatsAppFab` | `true` | Floating WhatsApp action. |

## Routes to fill in during integration

`TRAINING`, `ABOUT`, `CONTACTS`, `FAQ`, `PRIVACY`, `TERMS`, `ACCESSIBILITY`,
`NEWS`, `ANDROID_APP` default to `"#"` (rendered disabled). `EMPLOYEE_LOGIN`
defaults to `/employee` — confirm per deployment.

## Theming

Two layers, no code changes needed:

1. **MDMS/tenant theme**: set `--pgrl-<token>-brand` custom properties on
   `:root` (via `applyTheme.js` / tenant branding JSON). Every token defers to
   its `-brand` override, e.g. `--pgrl-primary-brand: 210 60% 35%;`.
2. **Per-mount**: pass the `tokens` prop.

Token names/kebab-case mapping are in `tokens.ts` (`typeReport` →
`--pgrl-type-report`). All colors are HSL channel triples (`"155 55% 32%"`).

## Localization

Every string resolves: MDMS key `PGR_LANDING_<KEY>` → built-in PT/EN deck →
raw key. To seed MDMS, the key list is `LANDING_COPY` in `content.ts`
(prefix each key with `PGR_LANDING_`). News items are plain strings by design
(CMS content, not UI copy).

## File map

```
Landing/
├── index.tsx            page assembly + public exports (default: PGRLandingPage)
├── routes.ts            LandingRoutes map + mergeRoutes
├── tokens.ts            design tokens (HSL triples), focus-ring constants
├── content.ts           copy deck (PT/EN) + section data (types, steps, channels, news)
├── useLandingCopy.ts    i18n resolution hook (MDMS → deck → key)
└── components/
    ├── LandingLink.tsx  router-optional anchor (placeholder-aware)
    ├── CtaLink.tsx      link-as-button variants (accent/primary/outline/inverse/subtle)
    ├── Section.tsx      section shell (rhythm, heading + yellow bar, landmarks)
    ├── UtilityBar.tsx   gov strip: green line, phone, language toggle, sign-in
    ├── LandingHeader.tsx masthead + sticky nav + mobile disclosure menu
    ├── HeroSection.tsx  H1, dual CTA, trust markers, channel chips
    ├── TypesSection.tsx 4 manifestation types (distinct accents, stretched links)
    ├── HowItWorksSection.tsx  6-step ordered list + follow-up callout
    ├── ChannelsSection.tsx    canonical channel inventory (incl. Linha Verde)
    ├── PrivacySection.tsx     confidentiality assurance + policy link
    ├── NewsSection.tsx        clamped news grid, <time>, placeholder art
    ├── InstitutionsSection.tsx IGE / IGSAE
    ├── FinalCtaSection.tsx    closing conversion band
    ├── LandingFooter.tsx      channels / links / access / legal + copyright
    └── WhatsAppFab.tsx        floating WhatsApp action
```
