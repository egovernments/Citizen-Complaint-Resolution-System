# PGR Public Landing Page — Redesign & Rebuild

Source analyzed: `https://prototiporecladenuncia.lovable.app/` (Lovable prototype,
"Portal de Reclamações e Denúncias · República de Moçambique", IGE/IGSAE).
Rebuilt as production React at
`digit-ui-esbuild/products/pgr/src/pages/citizen/Landing/`.

Scope guard honoured throughout: **only** the public landing page. No internal
pages, no registration flow, no auth, no backend. Every CTA resolves through a
configurable route map into the existing application.

---

## 1. UX Audit (of the prototype)

**Purpose** — public front door for the national grievance channel: explain the
four legal manifestation types, build trust (confidentiality, traceability),
and route citizens into submit/track flows across four channels (web, Android,
WhatsApp, toll-free line).

**User journey** — first-time citizen (needs orientation + reassurance),
returning citizen (needs *track* fast), staff (needs login). All three funnel
through one page.

Findings, ordered by impact:

| # | Severity | Finding |
|---|----------|---------|
| U1 | High | **One conflated CTA.** "Submeter ou Acompanhar Manifestação" merges the two jobs-to-be-done; a returning citizen who only wants status shares one button with a first-time complainant. Repeated identically in nav, hero and 4 type cards — 7 targets, 1 destination. |
| U2 | High | **The most inclusive channel is buried.** Linha Verde 1490 (toll-free) appears only in the footer; hero/channels promote only app + WhatsApp. For low-connectivity users the phone line is the primary channel. |
| U3 | High | **Type cards don't differentiate.** Four visually identical cards; in machine translation three of four render the same word ("Complaints") — the design relies purely on text to distinguish the four legal categories. |
| U4 | Medium | **Channel duplication.** "Also available through" (hero) and "Other Customer Service Channels" (section) repeat the same two channels with no added information. |
| U5 | Medium | **Three stacked header bars** (utility, masthead, nav strip) consume ~140px before content; none is sticky, so all actions scroll away. |
| U6 | Medium | **News cards dump full article bodies** (150+ words each), collapsing scannability; "Ler Mais" is a `<button>` (not a link — no middle-click/copy/SEO); three of four go nowhere. |
| U7 | Medium | **How-it-works trailing notes scattered** — three disconnected paragraphs (notifications, digital record, unique number) after the steps grid, with no visual binding. |
| U8 | Low | **Footer too thin for a gov portal** — channels + copyright only; no privacy policy, terms, FAQ, contacts, accessibility statement — the trust/legal surface citizens expect. |
| U9 | Low | **Auto-rotating hero carousel** with three unlabeled dot buttons ("Image 1/2/3"): motion without user intent, variable text contrast per slide, LCP cost. |

**Information hierarchy (kept)** — the section order is sound and was retained:
hero → types → how it works → channels → confidentiality → news → institutions
→ final CTA → footer.

## 2. UI Audit (of the prototype)

Extracted computed tokens: primary `hsl(155 55% 32%)` green, secondary
`hsl(155 60% 24%)`, accent `hsl(48 95% 55%)` yellow, bg `#F5F5F5`,
fg `#212121`, muted `hsl(0 0% 38%)`, radius `0.125rem`, Source Sans 3,
h1 48px/700.

| # | Finding |
|---|---------|
| V1 | **Contrast failures**: yellow accent used as text on white (motto "Transparência · Integridade", ~2.1:1); thin white text over variable hero photos; muted grey `#616161` borderline on `#F5F5F5`. |
| V2 | **Weak hierarchy rhythm**: section paddings vary; h2s identical weight/size with no anchoring element; cards share one elevation so nothing leads. |
| V3 | **Inconsistent affordances**: ghost "Submeter →" buttons on cards vs solid yellow hero CTA vs text links; buttons and links visually interchangeable. |
| V4 | **2px radius + hairline borders** read dated rather than "official"; fine as identity, but paired with grey placeholder news images the page feels unfinished. |
| V5 | **Icon duplication**: same chat icon for Queixas and WhatsApp; no per-type identity. |

## 3. Redesign decisions (2026 pass)

1. **Dual CTA** — `Submeter Manifestação` (yellow, primary) + `Acompanhar
   Processo` (inverse outline) split U1's conflated action; repeated in nav and
   final band. Nav also carries both as separate items.
2. **Channels canonicalized** — one "Canais de Atendimento" section with all
   four channels including Linha Verde 1490 (fixes U2/U4); hero keeps compact
   chips only; FAB keeps WhatsApp one-tap.
3. **Type identity** — per-type icon + accent color (blue/amber/green/red top
   border, tinted icon badge); whole card is a single stretched-link target
   (fixes U3, kills 4 repeated buttons).
4. **Header consolidation** — deep-green utility strip + white masthead + green
   primary nav; nav is `sticky` (actions never scroll away); yellow underline
   = active state; mobile disclosure menu with correct ARIA (fixes U5).
5. **Carousel removed** — static gradient + dot-grid pattern, optional photo
   under a fixed green scrim (guaranteed contrast, no motion, no LCP penalty)
   (fixes U9, V1-hero).
6. **Trust above the fold** — confidential / unique case number / SMS-WhatsApp
   notifications as hero trust markers; consolidated "Acompanhamento
   garantido" callout after the steps (fixes U7).
7. **News as cards, not articles** — clamped titles (2-3 lines) and excerpts
   (3 lines), `<time>` elements, tag chips, real links with external-link
   indicators, branded gradient placeholder when no image (fixes U6, V4).
8. **Gov-grade footer** — identity block + Canais Oficiais + Links Úteis +
   Acesso (citizen/employee logins) + Informação Legal (privacy/terms/
   accessibility) (fixes U8).
9. **Contrast-checked palette** — same Mozambique identity, every pair
   computed against WCAG 2.2 AA (see §8); yellow never used as text on light
   surfaces.
10. **Typography** — stays on the app's Roboto stack (v2 layer baseline): one
    font pipeline, no second webfont download; scale 12/14/16/18/20/24/30/48.

## 4. Component tree

```
PGRLandingPage (index.tsx)                    props: routes, news, heroImageUrl,
│                                             emblemUrl, languages, onLanguageChange,
│                                             tokens, showWhatsAppFab
├─ SkipLink (inline)
├─ UtilityBar                 gov name · Linha Verde · phone · PT/EN (aria-pressed) · Entrar
├─ LandingHeader              masthead (emblem, identity, motto) + sticky nav + mobile menu
├─ main#pgr-landing-main
│  ├─ HeroSection             eyebrow · h1 · lede · dual CTA · trust markers · channel chips
│  ├─ TypesSection            4 × type card (stretched link, per-type accent)
│  ├─ HowItWorksSection       ol 6 steps + "Acompanhamento garantido" callout
│  ├─ ChannelsSection         4 × channel card (web/app/WhatsApp/Linha Verde)
│  ├─ PrivacySection          lock panel + privacy-policy link
│  ├─ NewsSection             n × news card (clamped, <time>, tag) + "ver todas"
│  ├─ InstitutionsSection     IGE · IGSAE
│  └─ FinalCtaSection         closing band, submit + WhatsApp
├─ LandingFooter              identity + 4 nav groups + copyright
└─ WhatsAppFab                fixed, labeled, safe-area aware

Atoms: LandingLink (router-optional anchor, "#"-placeholder-aware)
       CtaLink    (accent | primary | outline | inverse | subtle × md | lg)
       Section    (rhythm shell, h2 + yellow bar, aria-labelledby)
Data:  routes.ts · tokens.ts · content.ts · useLandingCopy.ts
```

## 5. Folder structure & architecture

See the file map in the folder's [README](../../digit-ui-esbuild/products/pgr/src/pages/citizen/Landing/README.md).
Architectural choices:

- **Content/presentation split** — all copy (PT/EN) and section data live in
  `content.ts`; components are pure renderers. Adding a channel or step is a
  data edit.
- **Route indirection** — components never hardcode destinations; everything
  resolves through `LandingRoutes` (`ROUTES.REGISTER_COMPLAINT` style), merged
  from defaults + prop overrides. `"#"` placeholders render *disabled*
  controls, not dead links.
- **Router-optional** — `LandingLink` reads react-router v5's `__RouterContext`
  directly: inside the app it upgrades internal hrefs to `history.push`;
  standalone it degrades to plain anchors. No `<Link>` import that would throw
  without a Router.
- **i18n with graceful degradation** — `useLandingCopy` tries MDMS key
  `PGR_LANDING_<KEY>`, falls back to the built-in deck by active language.
  Ships fully localized PT/EN with zero seeding; MDMS overrides win later.
- **Scoped styling** — Tailwind under the repo's `.v2-scope` important-selector
  (utilities compile to `.v2-scope .util`, never leak to legacy pages);
  explicit `m-0`/`list-none`/`no-underline`/`border-solid` everywhere because
  preflight is off and legacy globals apply.
- **Optimized rendering** — static content = zero re-render pressure; `routes`
  and token style memoized; only stateful nodes are the mobile menu and
  language toggle; icons tree-shaken from lucide; news images `loading="lazy"`;
  no carousel/JS animation (CSS transitions only, `motion-safe:` gated).

## 6. Responsive strategy

Mobile-first; breakpoints follow the repo config (sm 640 / md 768 / lg 1024 /
xl 1280, centered container, 1rem gutter).

| Region | <640 | ≥640 | ≥768 | ≥1024 | ≥1280 |
|---|---|---|---|---|---|
| Utility bar | phone+lang+login only | +gov name/green line | +phone | — | — |
| Nav | hamburger disclosure | — | horizontal, sticky | +motto block | — |
| Hero CTAs | stacked, full-width | inline row | — | h1 40px | h1 48px |
| Types | 1 col | 2 col | — | — | 4 col |
| Steps | 1 col | 2 col | — | 3 col | — |
| Channels / News | 1 col | 2 col | — | — | 4 col |
| Institutions | 1 col | — | 2 col | — | — |
| Footer | 1 col | 2 col | — | 6-col grid (identity spans 2) | — |

Touch targets ≥44px (`min-h-[44px]` CTAs, 48px nav rows, 56px FAB); FAB offsets
by `env(safe-area-inset-bottom)`.

## 7. Accessibility report (WCAG 2.2 AA)

Verified in a rendered browser (accessibility tree inspected + interactions
driven):

- **Structure** — one `h1`; h2 per section via `Section` (`aria-labelledby`);
  h3 for cards; landmarks: `banner`, `nav` (labelled ×5 incl. footer groups),
  `main`, `contentinfo`; steps are an `<ol>`; card grids are `<ul>`.
- **Skip link** — first tab stop, visible on focus, targets `#pgr-landing-main`.
- **Mobile menu** — `aria-expanded`/`aria-controls` verified toggling; Escape
  closes and returns focus to the trigger (verified); items close menu on
  navigate.
- **Language toggle** — `role=group` + `aria-pressed` (verified flipping);
  labels are text, not flags.
- **Links vs buttons** — every navigation is a real `<a>`; placeholder ("#")
  destinations render `role=link aria-disabled=true` without href — announced
  disabled, out of tab order, visually dimmed (verified in AX tree).
- **External links** — `rel="noopener noreferrer"` auto-applied on `_blank`;
  `sr-only` "(abre numa nova janela)" note on channel CTAs; icon indicators
  `aria-hidden`.
- **Stretched links** — type/news cards use one link (title) with
  `after:inset-0`; single tab stop per card, accessible name = title.
- **Motion** — no autoplaying motion; transforms behind `motion-safe:`.
- **Contrast** — all pairs computed (§8); two prototype failures fixed by
  design (yellow-as-text on white eliminated; hero text over photos replaced
  by fixed scrim).

Known limits: `TYPE_CTA` "Submeter" arrow hint on type cards is `aria-hidden`
(decorative — the card link carries the name); news "Ler mais" is likewise
decorative with the title as the real link.

## 8. Design system

Tokens (HSL triples in `tokens.ts`, exposed as `--pgrl-*`, each overridable via
`--pgrl-*-brand` at `:root` or the `tokens` prop):

| Token | Default | Role | Key contrast (computed) |
|---|---|---|---|
| `primary` | `155 55% 32%` (#25805B) | nav, emphasis, icons | on white 5.0:1 ✓; white on it 5.0:1 ✓ |
| `deep` | `158 62% 17%` (#104633) | hero, footer, bands | white on it 12.6:1 ✓; accent on it 6.9:1 ✓ |
| `accent` | `48 95% 52%` (#F9CA10) | primary CTA, indicators | `on-accent` on it 11.1:1 ✓; vs deep (UI indicator) 4.5:1 ✓ |
| `accent-hover` | `45 92% 45%` | CTA hover | never used as text on light |
| `on-primary` | white | text on green | — |
| `on-accent` | `160 30% 8%` | text on yellow | — |
| `ink` / `ink-soft` | `0 0% 13%` / `0 0% 33%` | body / secondary | ink-soft on white 7.4:1 ✓ |
| `surface` / `page` / `line` | white / `0 0% 97%` / `0 0% 88%` | surfaces | — |
| type accents | blue `210 60% 36%` · amber `28 85% 38%` · green `155 55% 30%` · red `0 65% 42%` | per-type identity | each ≥4.5:1 on white ✓ |
| `radius` | `0.375rem` | corners | — |

Type scale: Roboto; 48/30/24 headings (bold), 18 lede, 16 body, 14 support,
12 meta — matching the v2 layer's fontSize config. Spacing: section rhythm
`py-12 md:py-16`; card padding 24px; grid gap 20px. Elevation: `shadow-sm`
rest → `shadow-md` hover (cards), `shadow-lg` FAB.

Signature elements: h2 + 48×4px yellow bar; yellow active-nav underline;
per-type color-coded top borders; deep-green gradient bands (150°) with dot
grid.

## 9. Verification performed

- esbuild bundle of the page with the repo's exact flags — clean.
- Tailwind compile with the repo config — all landing classes generated
  (gradient, safe-area FAB offset, line-clamp, sr-only variants spot-checked
  in the output CSS).
- Standalone browser render (no Router, empty i18n resources): desktop 1440
  and mobile 390 full-page screenshots; AX tree inspection; mobile menu
  open/Escape/focus-return; language toggle PT→EN including `aria-pressed`.
- Adversarial multi-agent review (correctness/integration, a11y+contrast
  math, i18n/PT copy/prototype parity) — all confirmed findings applied,
  notably: sticky nav moved out of `<header>` (zero sticky travel inside its
  own parent), basename-aware anchor hrefs via `history.createHref` (fixes
  middle-click/new-tab 404s under `/digit-ui`), custom `CONTAINER` constant
  replacing Tailwind's `container` class (legacy global
  `.container{display:flex;flex-direction:row}` collision), `font-sans` pinned
  on `<header>` (legacy bare `header{font-family:"Roboto Condensed"}` rule),
  news-tag/motto/FAB-ring/CTA-hover contrast corrections, mobile active-nav
  yellow bar, `scroll-padding-top` for the sticky bar (SC 2.4.11), and EN
  translation-drift fixes (IGSAE name, IGE functions). Post-fix re-render
  verified sticky engagement, scroll padding, and unchanged layout.

## 10. Integration guide

See [`Landing/README.md`](../../digit-ui-esbuild/products/pgr/src/pages/citizen/Landing/README.md)
— repo-specific quick start (public `<Route>` registration), generic-app usage,
props table, route placeholders to fill, theming and localization seeding.

## 11. Future enhancements

1. **Seed `PGR_LANDING_*` keys in MDMS** (DDH `rainmaker-pgr` bundle) so tenant
   localization owns the copy; the built-in deck then only guards cold starts.
2. **News from CMS** — replace `DEFAULT_NEWS` with an MDMS/CMS fetch behind the
   existing `news` prop; add a small skeleton state.
3. **Track-by-number widget** in the hero (input + go) once a public
   track-by-id route exists — removes one more hop for returning citizens.
4. **Real emblem + hero photography** via `emblemUrl`/`heroImageUrl` (scrim
   already guarantees contrast).
5. **Basename-aware standalone fallback** — if the page is ever hosted with no
   Router under a basename, prefix the route map once at the callsite
   (`mergeRoutes` with absolute paths).
6. **Analytics hooks** — a `onCtaClick(routeKey)` prop for funnel measurement
   (submit vs track vs channel) without coupling to a specific tracker.
7. **Android app link** — set `ANDROID_APP` when the Play listing exists; the
   disabled chips/cards light up automatically.
8. **Structured data** — `GovernmentOrganization` / `FAQPage` JSON-LD for SEO
   once the FAQ route is real.
