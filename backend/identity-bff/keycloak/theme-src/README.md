# DIGIT Keycloak login themes

One Keycloakify build, one jar (`configurator-blue-login-theme.jar`), three
login themes selected per client by `login_theme`:

| Theme | For | Source |
| --- | --- | --- |
| `configurator-blue` | the Configurator (`digit-identity-bff`, magic link) | `src/login` |
| `digit-employee` | digit-ui employee sign-in (`digit-ui-employee`, #2167) | `src/digit/employee` |
| `digit-citizen` | digit-ui citizen phone + SMS OTP (`digit-ui-citizen`, #2167) | `src/digit/citizen` |

`src/login/KcPage.tsx` dispatches on `kcContext.themeName`; each theme is a
separate lazy chunk, so one theme's stylesheet never loads for another.
The digit themes are described at the end of this file.

## Configurator Blue

A [Keycloakify](https://keycloakify.dev) login theme so that the screens
Keycloak owns look like the Configurator. It exists because password sign-in
has to stay inside Keycloak's browser flow: the alternative — an
application-owned password endpoint — would move credentials into DIGIT and
quietly drop required actions, MFA, password expiry, account linking and
browser SSO. See [CCRS #2108](https://github.com/egovernments/Citizen-Complaint-Resolution-System/issues/2108).

The browser posts the password to Keycloak and to nothing else. This theme is a
skin: it does not authenticate, authorize, or resolve tenants.

## What is themed

Every screen reachable from the supported password journey:

| Screen | Page |
| --- | --- |
| Password challenge, invalid credentials, identity providers | `login.ftl` |
| Identity-first challenge (two-step realms) | `login-username.ftl`, `login-password.ftl` |
| Forgotten password (only where a realm re-enables Keycloak's own reset) | `login-reset-password.ftl` |
| Password setup / reset required action | `login-update-password.ftl` |
| Email verification required action | `login-verify-email.ftl` |
| Account/identity conflicts from Google or GitHub | `login-idp-link-confirm.ftl`, `login-idp-link-confirm-override.ftl`, `login-idp-link-email.ftl` |
| Expired authentication session | `login-page-expired.ftl` |
| Information and generic errors | `info.ftl`, `error.ftl` |

Anything else (TOTP setup, recovery codes, a user-profile step) still renders
through Keycloakify's `DefaultPage`, but inside this theme's template and with
this theme's class map (`src/login/classes.ts`), so no screen falls back to the
stock Keycloak appearance.

## Where the design comes from

- **Palette** — generated, not retyped. `npm run tokens` evaluates
  `configurator/src/themes/index.ts` and writes the `cms-blue` preset to
  `src/login/styles/tokens.generated.css`. The generated file is committed so
  the theme builds without reaching outside `backend/identity-bff`; palette
  updates are an explicit theme-maintenance operation, not a cross-project CI
  dependency.
- **Layout and primitives** — `src/login/Template.tsx` is a port of the
  Configurator's `AuthShell`, and `src/login/styles/theme.css` restates only the
  utility values the auth screens use, each annotated with the Tailwind class it
  mirrors. Tailwind and the shadcn primitives are deliberately not vendored.
- **Assets** — the photograph and the logo are the Configurator's, fetched from
  `/configurator/brand/` on the same origin. Nothing is copied. If they cannot
  be fetched the backdrop falls back to the gradient, which is built on the same
  navy as `--secondary`.
- **Type** — Inter, the family the Configurator loads, but self-hosted
  (`src/login/fonts`, SIL OFL). A login page should not depend on a third-party
  font host being reachable, and the screenshot baselines would flap with it.
- **Copy** — Keycloak's message bundle wherever Keycloak has a string, so a
  realm override or a Keycloak upgrade keeps working. Theme-defined copy lives
  in `src/login/i18n.ts` (English and French; Bomet enables `fr_FR`).

## Working on it

```bash
npm install
npm run dev          # http://localhost:5173/dev.html?page=login.ftl
npm test             # rendering and page coverage
npm run build-keycloak-theme   # dist_keycloak/configurator-blue-login-theme.jar
```

`dev.html` takes `?page=<pageId>` and an optional `&state=invalid-credentials`
or `&state=password-mismatch`. The dev server also serves the Configurator's
brand assets at `/configurator/brand/`, so what you see is what a deployment
serves.

### Against a real Keycloak

```bash
npm run smoke
```

Builds the `identity-keycloak` image, starts it, seeds a realm and a client with
`login_theme=configurator-blue`, and drives the resulting authorization URL in a
browser:
the theme is selected and loads, Keycloak's form and hidden `credentialId`
survive underneath it, the password posts to Keycloak's own origin, and a wrong
password produces the themed error without naming which half failed. CI runs the
same script against the image it just built.

### Screenshots

```bash
npm run screenshots           # compare against the baselines
npm run screenshots:update    # re-record them
```

Both run inside the pinned Playwright container on `linux/amd64`, because
baselines have to be rasterized the way CI rasterizes them. Desktop is
1440×900; mobile is a Pixel 7, where the brand panel is hidden and the card
stands alone.

## Deployment

The theme is built into the Keycloak image by
`backend/identity-bff/keycloak/Dockerfile.magic-link` and lands as
`/opt/keycloak/providers/configurator-blue-login-theme.jar`. It is selected **per client**
by `deploy/digit-compose/configure-keycloak.sh` (`attributes.login_theme`) on
the identity BFF and magic-link clients; the shared realm's `loginTheme` is left
empty so unrelated clients keep their own.

Two values can be set per deployment without rebuilding, through Keycloak's
theme environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `DIGIT_BRAND_BASE_URL` | `/configurator/brand` | Where the shared brand assets are served. Use an absolute URL if Keycloak is on its own host. |
| `DIGIT_APP_NAME` | `DIGIT Complaint Management` | The product name on the brand panel. |

### Keycloak upgrades

`vite.config.ts` pins `keycloakVersionTargets` to `all-other-versions` only,
matching the image's Keycloak 26.7.3. When Keycloak is upgraded:

1. bump `KEYCLOAK_VERSION` in `keycloak/Dockerfile.magic-link`;
2. `npx keycloakify eject-page` any page whose FreeMarker contract changed, or
   re-check the overridden pages against the new `keycloak.v2` sources;
3. run `npm test` and `npm run screenshots`;
4. rebuild the image — `kc.sh build` fails loudly if the jar does not fit.

## digit-employee and digit-citizen

The legacy digit-ui login pages, rendered by Keycloak (#2167):
`pages/employee/Login/login.js` (V2LoginShell + V2Card, privacy consent,
carousel variant) and `pages/citizen/Login/{SelectMobileNumber,SelectOtp,SelectName}.js`
in the citizen top bar and footer. `src/digit/styles/digit.css` restates the
*computed* styles measured on the running legacy pages rather than vendoring
digit-ui's stylesheets; each block names the legacy selector it mirrors.

### Tenant branding

- The tenant slug comes from `kcContext.digitTenant` (set by the DIGIT
  FreeMarker provider from the `digit_tenant` authorization parameter), else
  from `digit_tenant` on the page URL, remembered in sessionStorage under the
  login tab's `tab_id`.
- The theme fetches `GET {DIGIT_IDENTITY_BFF_BASE_URL}/identity/v1/tenant-contexts/{slug}/branding`
  (`?locale=fr_FR` etc. for a non-English Keycloak locale) and caches it for
  the browser session. Nothing tenant-coloured paints until it resolves; on any
  failure the pages render the default DIGIT look.
- `themeConfig` is applied by `src/digit/theme/applyTheme.ts`, a port of
  digit-ui-esbuild `src/theme/applyTheme.js` (default theme first, tenant record
  on top). `tests/digit/applyTheme.test.ts` checks it against output recorded
  from the original (`node scripts/generate-applytheme-golden.cjs`).
- Strings come from `branding.messages`; `src/digit/branding/strings.ts`
  lists every key the pages read with digit-ui's own English fallback. The BFF
  must also include `TENANT_TENANTS_{CODE}`, the keys a PrivacyPolicy record
  refers to (`privacyMessageKeys`) and carousel titles/descriptions.

| Variable | Default | Meaning |
| --- | --- | --- |
| `DIGIT_IDENTITY_BFF_BASE_URL` | empty (same origin) | Where the identity BFF's public branding endpoint is served. |

### Keycloak contract

- Custom pages (emitted because `src/login/KcContext.ts` declares them):
  `login-phone-number.ftl` (posts `phoneNumber`, the national digits; reads
  `countryCode`, `mobileNumberRegex`), `login-sms-otp.ftl` (posts `otp`, or
  `resend=true`; reads `maskedPhoneNumber`, `resendAvailableInSeconds`,
  `otpLength`), `login-phone-profile.ftl` (posts `firstName`).
- Error keys the SPI sets are defined in `src/login/i18n.ts`
  (`digitInvalidPhone`, `digitInvalidOtp`, `digitOtpExpired`,
  `digitTooManyAttempts`, `digitResendTooSoon`, `digitSmsSendFailed`).
  Invalid phone / OTP show inline the way digit-ui does; the rest, and every
  other Keycloak error, raise the legacy toast.

### Working on them

```bash
npm run dev
# http://localhost:5173/dev.html?theme=digit-employee&page=login.ftl
# http://localhost:5173/dev.html?theme=digit-citizen&page=login-sms-otp.ftl&state=invalid-otp
```

`state` is one of `invalid-credentials`, `account-disabled`, `invalid-phone`,
`invalid-otp`, `resend-ready`, `sms-failed`; `tenant=none` drops the slug
(default look), `tenant=bomet-carousel` shows the carousel layout. The dev
server answers the branding endpoint from `tests/digit/fixtures/branding-{slug}.json`
(Bomet County's real ThemeConfig v3 and login strings, a placeholder crest) and
serves digit-ui's "Powered by DIGIT" wordmarks at `/digit-ui/brand/`.
Screenshot baselines for both themes are in `tests/visual/digit.spec.ts`.
