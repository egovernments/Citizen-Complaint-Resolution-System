# Citizen Profile Page (P3) — Design

**Route:** `/citizen/profile`
**Sidebar:** "Profile" (UserCircle icon), below "My Complaints"

## API contract (probed against naipepea egov-user, 2026-05-26)

`POST /user/profile/_update?tenantId=ke`

```json
{
  "RequestInfo": {
    "apiId": "citizen-ui",
    "authToken": "<token>",
    "userInfo": { "id": 411, "uuid": "...", "userName": "<mobile>",
                  "tenantId": "ke", "type": "CITIZEN" }
  },
  "user": {
    "id": 411, "uuid": "...", "tenantId": "ke",
    "userName": "<mobile>", "mobileNumber": "<mobile>",
    "name": "...", "emailId": "...", "gender": "MALE|FEMALE|OTHER",
    "dob": "DD/MM/YYYY", "photo": "<filestore-id>",
    "type": "CITIZEN", "active": true,
    "roles": [{ "code": "CITIZEN", "name": "Citizen", "tenantId": "ke" }]
  }
}
```

**Pinning the quirks** (each cost a probe to find):

1. `id` (Long) MUST be present in BOTH `userInfo` AND `user` — without it,
   `User.isLoggedInUserDifferentFromUpdatedUser` NPEs at line 208.
2. `active: true` MUST be set on every PATCH or the user is deactivated and
   can no longer log in. (Update is a full-overwrite of mutable fields.)
3. **Mobile change is silently dropped.** Sending a different `mobileNumber`
   or `userName` returns HTTP 200 but the response echoes the original. No
   `/user/_updatemobile` endpoint exists on this DIGIT version. We surface
   mobile read-only.
4. `dob` accepts `DD/MM/YYYY` on send, stored as `YYYY-MM-DD`.
5. Omitting any field (e.g. `gender`) nulls it — must echo the current value.

## Page layout

- Avatar (current photo from filestore via `/filestore/v1/files/url`) +
  "Change photo" button → file picker → `POST /filestore/v1/files` (module
  `user-profile`) → setValue('photo', fileStoreId) → on Save, the new id
  rides in the profile PATCH. No staging copy — the citizen sees the new
  photo immediately after upload, persisted on Save.
- Read-only fields: **Mobile** (with a one-liner explaining we can't change
  it here — citizens would have to re-register with a new mobile).
- Editable fields: Name, Email, Gender (radio: Male/Female/Other), DOB
  (date input).
- Save / Reset buttons. Reset reverts unsaved edits to last fetched state.
- Sign out card at the bottom — second prominent CTA in addition to the
  top-bar button. Confirms before signing out.

## Data flow

1. `useCitizenProfile()` hook
   - `query`: `/user/_search` with `uuid: [<current uuid>]` (cached 30s).
   - `mutation`: PATCH builder that takes a partial + merges with current,
     calls `/user/profile/_update`, invalidates the query on success.
2. Page uses `react-hook-form` for edit state; defaults from query.
3. Photo upload uses raw fetch (`/filestore/v1/files`) and writes
   `setValue('photo', id)` so the form is the single source of truth.

## Playwright

Extends `tests/citizen-login.spec.ts` with a 4th test:
- Sign in (existing helper)
- Navigate via sidebar to `/citizen/profile`
- Assert mobile is shown read-only
- Change name + email, click Save
- Reload page, assert the new values are persisted

## YAGNI

- No mobile-change dialog (API doesn't support it self-service).
- No password change (citizens use OTP — there's no password).
- No avatar cropping; we upload the file as-is. The browser shows it
  contain-fit in a 96px circle.
- No address fields. permanent/correspondence address are admin-only fields
  on this DIGIT version and citizens never touch them.
