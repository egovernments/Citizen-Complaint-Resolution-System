# Identity Keycloak

This directory owns the shared identity realm, its configuration script, the
Keycloak 26.7.3 image with the magic-link provider, and both login themes.
The BFF reads realm policy; it does not configure the realm.

`configure-keycloak.sh` applies `realm.json` on each run. Ansible copies both
files to the deployment host and supplies client secrets and SMTP settings as
task-scoped environment variables. The canonical deployment is
`local-setup/docker-compose.egov-digit.yaml`; the image build uses this directory
as its Docker context. See `theme-src/README.md` for theme development.

## Realm policy

- User and admin events are enabled, including admin representations. Both
  retention periods default to **604800 seconds (seven days)**. The tolerated
  BFF outage must be shorter than seven days; the poller conservatively revokes
  when its checkpoint is older than retained history. The deployment can set
  `KEYCLOAK_EVENTS_EXPIRATION_SECONDS` to a longer positive duration.
- The BFF service account has `view-events` and the required Organization/user
  roles. Event fields are not transformed. Password changes use
  `details.code_id`, while ordinary logout events use `sessionId`; see the
  frozen BFF contract §10.
- People can view names but only admins can edit them. `lastName` is optional.
  DIGIT mirrors the whole name into `firstName`.
- Every configured IdP and IdP mapper uses `IMPORT`, preserving later local
  profile changes. Providers use the shared first-broker account-linking flow.
- The employee browser flow requires a password, then OTP only when the person
  has configured it. Enrolling TOTP turns on the second step at the next login.
- `clientPolicy.accountActions` becomes CSV `digit.auth.account.actions` on
  the BFF, employee and citizen clients. The BFF still checks the initiating
  person, credential type and provider eligibility. Password setup callbacks
  remain allowed for every surface.

The theme resolves the tenant slug through the public tenant-context route,
then fetches branding directly from public MDMS and localization. It never calls
the removed BFF branding relay. Branding environment values now belong to the
Keycloak container; the Ansible values remain shared with digit-ui.

## Checks

Run from the repository root:

```sh
(cd local-setup/tests && npx jest static/deployment-contracts.test.ts --runInBand)
npm run lint --prefix keycloak/theme-src
npm test --prefix keycloak/theme-src
keycloak/tests/run-live-check.sh
```

The live harness starts its own Keycloak 26.7.3 and Mailpit pair on a private
Docker network, exposes random loopback ports, applies the realm script twice,
and removes only its own containers/network. It never accesses a deployed host.
The Python browser drives actual Keycloak forms; no Keycloak responses are mocked.
Configuration-only checks rerun the script, so the suite takes several minutes.

The real-Keycloak checks cover event permissions and retention, profile policy,
IMPORT behavior, TOTP enrollment/enforcement/removal, password changes, verified
email changes and old-address notification, and IdP linking. A passing result
from this suite does **not** prove the BFF callback/session/revocation integration,
provider-unlink last-method protection, or the full §11 gate with real Redis,
egov-user and non-fixed egov-otp. Those gates remain with their owning lanes.

Keycloak CI separately builds the custom image, smoke-tests the packaged theme,
and runs screenshot regression in the pinned Playwright container. A stock-image
realm test alone does not prove custom theme packaging or magic-link behavior.
