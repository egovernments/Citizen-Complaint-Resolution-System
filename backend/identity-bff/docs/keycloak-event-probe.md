# Keycloak event probe (user events + admin events)

- Keycloak version: **26.7.3** (`quay.io/keycloak/keycloak:26.7.3`, `start-dev`)
- Date: **2026-10-04**
- Where: a throwaway local container only (`127.0.0.1:18089`). No shared or remote host was touched.
- Realm `probe`: `eventsEnabled=true`, `eventsExpiration=604800` (in seconds), `adminEventsEnabled=true`,
  `adminEventsDetailsEnabled=true`, `organizationsEnabled=true`. Event listener: the default `jboss-logging` only.
- Clients: `probe-web` is public, with standard flow and direct access grants. `probe-svc` is confidential and
  has a service account with the realm-management roles `view-events`, `view-users` and `manage-users`.
- The admin actions in rows c to f were done by the `probe-svc` service account. The Organization calls were done
  by the master `admin`, because `probe-svc` got **403** on `/organizations` with only those three roles.

## Results per action

| # | Action | Family | type / operationType + resourceType | resourcePath | Key fields present |
|---|---|---|---|---|---|
| a1 | Password grant login | user | `LOGIN` | n/a | id, time, userId, sessionId, clientId=`probe-web`, ipAddress. details: `auth_method, grant_type=password, scope, token_id, refresh_token_id, refresh_token_type, client_auth_method, username` |
| a1' | Password grant, wrong password | user | `LOGIN_ERROR`, `error=invalid_user_credentials` | n/a | id, time, userId, clientId, **no sessionId** |
| a2 | Authorization-code login (browser form) | user | `LOGIN` and then `CODE_TO_TOKEN` | n/a | Both have sessionId and clientId. LOGIN details: `auth_method, auth_type=code, response_type, redirect_uri, consent, code_id, username, response_mode`. CODE_TO_TOKEN details: `token_id, grant_type=authorization_code, scope, refresh_token_id, refresh_token_type, code_id, client_auth_method` |
| b | Logout of one session (OIDC `/logout` with refresh_token) | user | `LOGOUT` | n/a | id, time, userId, **sessionId = the session that ended**, clientId=`probe-web`. details: `client_auth_method` only |
| c | Admin "log out all sessions" `POST /users/{id}/logout` | admin | `ACTION` + `USER` | `users/{userId}/logout` | id, time, realmId, authDetails, **no representation**. **No user event at all** (no LOGOUT per session) |
| d | Admin disable `PUT /users/{id}` `{"enabled":false}` | admin | `UPDATE` + `USER` | `users/{userId}` | representation = **the request body as sent** (here `{"enabled":false}`). A full-object PUT echoes the full object, including `enabled:true` when nothing about `enabled` changed |
| e | Admin delete `DELETE /users/{id}` | admin | `DELETE` + `USER` | `users/{userId}` | representation = `{"id":..., "username":...}` |
| f | Admin reset password `PUT /users/{id}/reset-password` | admin | `ACTION` + `USER` | `users/{userId}/reset-password` | **No representation** (the secret is not logged). **No user event** (`UPDATE_PASSWORD`/`UPDATE_CREDENTIAL` do not appear) |
| g | Self password change (required action `UPDATE_PASSWORD` started by `kc_action=UPDATE_PASSWORD` from a live browser session) | user | `UPDATE_PASSWORD` **and** `UPDATE_CREDENTIAL` (same request, 1 ms apart), then a new `LOGIN` | n/a | id, time, userId, clientId=`probe-web`. **No `sessionId` field.** The session is in **`details.code_id`**. details: `credential_type=password, custom_required_action=UPDATE_PASSWORD, auth_method, response_type, redirect_uri, remember_me, code_id, response_mode, username` |
| g' | The same change with "Sign out from other devices" ticked (`logout-sessions=on`) | user | an extra `LOGOUT` for **each other** session, written before UPDATE_PASSWORD | n/a | sessionId = the session that was ended, clientId. `details.logout_triggered_by_required_action=UPDATE_PASSWORD`, and `details.code_id` = the session that made the change |
| h1 | Create organization | admin | `CREATE` + `ORGANIZATION` | `organizations/{orgId}` | representation = the org |
| h2 | Add member `POST /organizations/{orgId}/members` | admin | `CREATE` + `ORGANIZATION_MEMBERSHIP` | `organizations/{orgId}/members` (**no user id**) | representation = **the org**, not the user. `details: {username, email}`. No user id anywhere |
| h3 | Remove member `DELETE /organizations/{orgId}/members/{userId}` | admin | `DELETE` + `ORGANIZATION_MEMBERSHIP` | `organizations/{orgId}/members/{userId}` | representation = the org. `details: {username, email}` |
| h4 | Delete a user who is an org member | admin | only `DELETE` + `USER` | `users/{userId}` | The membership disappears with **no** `ORGANIZATION_MEMBERSHIP` event |
| h5 | Delete the organization | admin | `DELETE` + `ORGANIZATION` | `organizations/{orgId}` | representation null. No per-member events |
| x | (extra) Admin delete of one session `DELETE /sessions/{sid}` | admin | `DELETE` + `USER_SESSION` | `sessions/{sessionId}` (**no user id**) | representation `{"offline":false}`. No user event |
| i | Email verification | user | `VERIFY_EMAIL` was **not feasible** without SMTP | n/a | The required action tries to send mail first. The result is `SEND_VERIFY_EMAIL_ERROR` (`error=email_send_failed`, details include `email`, `code_id`, `reason`) and the page says "Failed to send email" |

### General shape notes (j)

- **User events** have an `id` (UUID). **Admin events** also have an `id` (UUID). Both `time` values are **epoch milliseconds**.
- User event fields: `id, time, type, realmId, clientId, userId, sessionId?, ipAddress, error?, details{}`.
  The `clientId` here is the client's **clientId string** (for example `probe-web`).
- Admin event fields: `id, time, realmId, authDetails{realmId, clientId, userId, ipAddress}, operationType,
  resourceType, resourcePath, representation? (a JSON string, not an object), details?`.
  `authDetails.clientId` is the client's **internal UUID**, not its clientId string. `authDetails.realmId` is the
  realm where the caller authenticated (the master realm id when the master admin made the change).
- Session ids in 26.7.3 are **24-character URL-safe strings** (for example `NwdMHLlWx7c-mHOCRuC1dmmY`), not UUIDs.
  The same value is the token `session_state`/`sid`.
- Disabling a user does **not** end their sessions. The session still shows under `/users/{id}/sessions`, but a refresh
  returns `invalid_grant: User disabled`. An admin password reset does not end sessions either, and refresh keeps
  working. No user event is stored for either case, because `REFRESH_TOKEN_ERROR` is not in the default
  `enabledEventTypes`.
- User events stay in place after the user is deleted.
- The account REST API (`/realms/probe/account/credentials`) has **no endpoint to set a password**: POST gives 405
  and PUT gives 404. It reports `updateAction: UPDATE_PASSWORD`, so a self change always goes through the
  required-action / `kc_action` browser flow. That flow was scripted headlessly with curl and a cookie jar.
- After a realm organization claims a domain (`probe.local`), the browser login for users of that domain becomes
  **two steps** (username first, then password).

### Query parameters

| Param | `/events` | `/admin-events` |
|---|---|---|
| default order | **newest first** | **newest first** |
| `direction=asc` / `desc` | works | works |
| `first` / `max` | works (offset / page size) | works |
| `dateFrom` / `dateTo` | accepts `yyyy-MM-dd` **or epoch ms**. Both are **inclusive** (`dateFrom=<exact event time>` returns that event) | same |
| type filter | `type=X`, repeatable (`type=UPDATE_PASSWORD&type=UPDATE_CREDENTIAL` works). An unknown type returns **HTTP 500** | `type` is **ignored**. Use `operationTypes=` and `resourceTypes=` (both repeatable). An unknown value returns **HTTP 500** |
| other | `user=<userId>`, `client=` | `resourcePath=` supports `*` globs (`users/*/logout` works) |

A service account with `view-events` can read both `/events` and `/admin-events`.

## Redacted samples

Token ids and secrets are replaced with placeholders. Realm, user, org and session ids are the real throwaway values.

User `LOGIN` (password grant):
```json
{"id":"f6531ec5-7f53-4922-9ab0-89523f582718","time":1791118938709,"type":"LOGIN",
 "realmId":"a9cbb114-34bf-44d1-a398-354813798345","clientId":"probe-web",
 "userId":"4937d6f3-ae29-441d-bdd0-d9cc38d89632","sessionId":"3waUbJt8sH2Bm2NMP6kuM3N_","ipAddress":"192.168.215.1",
 "details":{"auth_method":"openid-connect","token_id":"<TOKEN_ID>","grant_type":"password","refresh_token_type":"Refresh",
  "scope":"openid profile email","refresh_token_id":"<REFRESH_TOKEN_ID>","client_auth_method":"client-secret","username":"alice"}}
```

User `LOGIN` (authorization code):
```json
{"id":"3fe9ac2c-81c3-4a85-9af2-b55def99ce50","time":1791118949605,"type":"LOGIN",
 "realmId":"a9cbb114-34bf-44d1-a398-354813798345","clientId":"probe-web",
 "userId":"e2b07219-1032-47bb-a59e-7f825dc37164","sessionId":"NwdMHLlWx7c-mHOCRuC1dmmY","ipAddress":"192.168.215.1",
 "details":{"auth_method":"openid-connect","auth_type":"code","response_type":"code","redirect_uri":"http://127.0.0.1:18099/cb",
  "consent":"no_consent_required","code_id":"NwdMHLlWx7c-mHOCRuC1dmmY","username":"carol","response_mode":"query"}}
```

User `LOGOUT` (one session):
```json
{"id":"217119d6-7115-42e2-9ead-ac96c4f85568","time":1791118938874,"type":"LOGOUT",
 "realmId":"a9cbb114-34bf-44d1-a398-354813798345","clientId":"probe-web",
 "userId":"4937d6f3-ae29-441d-bdd0-d9cc38d89632","sessionId":"obAPenAJy-AxMWjt2yYhnDAJ","ipAddress":"192.168.215.1",
 "details":{"client_auth_method":"client-secret"}}
```

User `UPDATE_PASSWORD` (self change). `UPDATE_CREDENTIAL` is identical apart from `id`, `type` and `time` +1 ms:
```json
{"id":"8767507b-8ff5-4b14-93ad-ff3fa02bcb7d","time":1791118966272,"type":"UPDATE_PASSWORD",
 "realmId":"a9cbb114-34bf-44d1-a398-354813798345","clientId":"probe-web",
 "userId":"e2b07219-1032-47bb-a59e-7f825dc37164","ipAddress":"192.168.215.1",
 "details":{"credential_type":"password","auth_method":"openid-connect","custom_required_action":"UPDATE_PASSWORD",
  "response_type":"code","redirect_uri":"http://127.0.0.1:18099/cb","remember_me":"false",
  "code_id":"NwdMHLlWx7c-mHOCRuC1dmmY","response_mode":"query","username":"carol"}}
```

User `LOGOUT` caused by a self change with "sign out other devices":
```json
{"id":"cdd76bfd-7805-4c4a-8247-ec6078db1e38","time":1791118979325,"type":"LOGOUT",
 "realmId":"a9cbb114-34bf-44d1-a398-354813798345","clientId":"probe-web",
 "userId":"1f385e5d-acb4-4b16-9fc3-b8fade65cc9f","sessionId":"wCadowZuCJrvxJpTms4uPKHa","ipAddress":"192.168.215.1",
 "details":{"credential_type":"password","auth_method":"openid-connect","logout_triggered_by_required_action":"UPDATE_PASSWORD",
  "custom_required_action":"UPDATE_PASSWORD","response_type":"code","redirect_uri":"http://127.0.0.1:18099/cb",
  "remember_me":"false","code_id":"Xz1mBFlMPtEKmYhMOaRaSUDq","response_mode":"query","username":"dave"}}
```

User `SEND_VERIFY_EMAIL_ERROR` (no SMTP):
```json
{"type":"SEND_VERIFY_EMAIL_ERROR","error":"email_send_failed","clientId":"probe-web","userId":"c88bc761-a6b6-4b6f-9360-9d11e6475efc",
 "details":{"reason":"Invalid sender address 'null'. ...","email":"erin@probe.local","code_id":"yD7UM_3H9nVpz0C8IOskokLw","username":"erin"}}
```

Admin logout-all:
```json
{"id":"8902a006-a477-4dad-a17f-44d0c2cd0f12","time":1791118993367,"realmId":"a9cbb114-34bf-44d1-a398-354813798345",
 "authDetails":{"realmId":"a9cbb114-34bf-44d1-a398-354813798345","clientId":"a13e42f8-3833-47a1-a7fa-6b5e833a3b42",
  "userId":"9c933e91-cf01-4599-9a25-d4def71134f2","ipAddress":"192.168.215.1"},
 "operationType":"ACTION","resourceType":"USER","resourcePath":"users/4937d6f3-ae29-441d-bdd0-d9cc38d89632/logout"}
```

Admin disable (partial PUT):
```json
{"id":"232ef2cd-80bb-4818-b1d9-258ab3970ce4","time":1791119000696,"realmId":"a9cbb114-34bf-44d1-a398-354813798345",
 "authDetails":{"realmId":"a9cbb114-34bf-44d1-a398-354813798345","clientId":"a13e42f8-3833-47a1-a7fa-6b5e833a3b42",
  "userId":"9c933e91-cf01-4599-9a25-d4def71134f2","ipAddress":"192.168.215.1"},
 "operationType":"UPDATE","resourceType":"USER","resourcePath":"users/11820801-d8ed-4d84-956f-d350b3c714fa",
 "representation":"{\"enabled\":false}"}
```

Admin delete user:
```json
{"id":"bca77f1b-4f89-4bcb-a6a5-c195cd77e5dc","time":1791119016244,"realmId":"a9cbb114-34bf-44d1-a398-354813798345",
 "authDetails":{"...":"same shape as above"},
 "operationType":"DELETE","resourceType":"USER","resourcePath":"users/1f385e5d-acb4-4b16-9fc3-b8fade65cc9f",
 "representation":"{\"id\":\"1f385e5d-acb4-4b16-9fc3-b8fade65cc9f\",\"username\":\"dave\"}"}
```

Admin reset password:
```json
{"id":"cfcbb511-8817-47e2-947d-6bf44a61d153","time":1791119012431,"realmId":"a9cbb114-34bf-44d1-a398-354813798345",
 "authDetails":{"...":"same shape as above"},
 "operationType":"ACTION","resourceType":"USER","resourcePath":"users/c88bc761-a6b6-4b6f-9360-9d11e6475efc/reset-password"}
```

Admin org member removal:
```json
{"id":"560f98a1-2dab-4c7e-9795-58c99d682c9a","time":1791119022701,"realmId":"a9cbb114-34bf-44d1-a398-354813798345",
 "authDetails":{"realmId":"f78c858a-5dcc-4be1-83d4-f352099f4ce9","clientId":"72ab1cbe-2b26-423d-8f91-6102adbf1db7",
  "userId":"e2304175-14b1-4d63-ad0b-208a27661678","ipAddress":"192.168.215.1"},
 "operationType":"DELETE","resourceType":"ORGANIZATION_MEMBERSHIP",
 "resourcePath":"organizations/ec292c52-fe33-4c49-95b4-486e19df4792/members/c88bc761-a6b6-4b6f-9360-9d11e6475efc",
 "representation":"{\"id\":\"ec292c52-fe33-4c49-95b4-486e19df4792\",\"name\":\"Probe Org\",\"alias\":\"probe-org\",\"enabled\":true,\"domains\":[{\"name\":\"probe.local\",\"verified\":false}]}",
 "details":{"email":"erin@probe.local","username":"erin"}}
```

Admin org member add. Note that the path has no user id:
```json
{"operationType":"CREATE","resourceType":"ORGANIZATION_MEMBERSHIP",
 "resourcePath":"organizations/ec292c52-fe33-4c49-95b4-486e19df4792/members",
 "representation":"{\"id\":\"ec292c52-...\",\"name\":\"Probe Org\",...}","details":{"email":"erin@probe.local","username":"erin"}}
```

Admin single-session delete:
```json
{"operationType":"DELETE","resourceType":"USER_SESSION","resourcePath":"sessions/GGH4WWEUZYnvqCPF-zxBVKlI","representation":"{\"offline\":false}"}
```

## What the poller should match

Poll `/admin-events` and `/events` with `dateFrom=<last seen time in ms>` (it is inclusive, so drop ids you have
already seen) and `direction=asc`. Page through with `first`/`max`. De-duplicate by the event `id`.

- **Disable**: admin `operationType=UPDATE`, `resourceType=USER`, `resourcePath=users/{userId}` (exactly two
  segments), and the parsed `representation` has `enabled === false`. Do not treat a missing `enabled` as a change.
  A full PUT with `enabled:true` is not a revocation. The event has no "before" state, so you cannot tell whether
  the user was already disabled.
- **Delete**: admin `operationType=DELETE`, `resourceType=USER`, `resourcePath=users/{userId}`. Take the userId from
  the path (it is also in `representation.id`). This **also** covers the user's org memberships, because there is no
  separate membership event for them.
- **Logout-all**: admin `operationType=ACTION`, `resourceType=USER`, `resourcePath=users/{userId}/logout`. No user
  events come with it, so the admin event is the only signal.
- **Single session revoked by an admin** (extra): admin `operationType=DELETE`, `resourceType=USER_SESSION`,
  `resourcePath=sessions/{sessionId}`. The path has no userId, so map it from the sessionId.
- **Credential change by an admin**: admin `operationType=ACTION`, `resourceType=USER`,
  `resourcePath=users/{userId}/reset-password`. No user event is produced, and Keycloak does **not** end sessions
  on its own.
- **Credential change by the user**: user event `type=UPDATE_CREDENTIAL` (or `UPDATE_PASSWORD`; both fire for
  passwords, so match one or de-duplicate by userId+time). Use `userId`, `clientId`, and
  **`details.code_id` as the session id**, because `sessionId` is absent. `details.credential_type` tells you which
  kind of credential changed (`password`).
- **Self password change with "sign out other devices"**: in addition, user `type=LOGOUT` with
  `details.logout_triggered_by_required_action=UPDATE_PASSWORD` for each other session (`sessionId`, `clientId`).
  The session that made the change (`details.code_id`) is kept.
- **Normal logout**: user `type=LOGOUT`, using `sessionId` and `clientId`.
- **Org membership removal**: admin `operationType=DELETE`, `resourceType=ORGANIZATION_MEMBERSHIP`,
  `resourcePath=organizations/{orgId}/members/{userId}`. Parse both ids from the path. Also treat
  `DELETE ORGANIZATION` (`organizations/{orgId}`) as removing every member, because it emits no per-member events.
  Membership *adds* have no userId (only `details.username`/`email`).
- Filters that are cheap to use on the server side: `/admin-events?resourceTypes=USER&resourceTypes=ORGANIZATION_MEMBERSHIP&resourceTypes=USER_SESSION&resourceTypes=ORGANIZATION&operationTypes=UPDATE&operationTypes=DELETE&operationTypes=ACTION`
  and `/events?type=LOGOUT&type=UPDATE_CREDENTIAL`. Never send an unknown enum value, because it returns HTTP 500.
