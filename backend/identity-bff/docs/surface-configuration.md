# Browser surfaces and OTP delivery

`IDENTITY_SURFACES_JSON` extends the default `configurator`, `employee`, and
`citizen` entries. Existing client, scope and cookie environment variables
supply the defaults. Each new entry must provide all required fields:

```json
{
  "reviewer": {
    "contextKind": "employee",
    "clientId": "digit-ui-reviewer",
    "clientSecret": "<server-only secret>",
    "scope": "openid profile email",
    "cookieName": "digit_identity_session_reviewer",
    "prompt": "select_account"
  }
}
```

`contextKind` selects existing configurator, employee or citizen behavior.
Tenant-bound return paths use the registry key: `/county/digit-ui/reviewer/`.
Client IDs and cookies must be distinct. Invalid entries fail app startup.
An empty or omitted prompt sends no `prompt` parameter. The default employee
and citizen entries retain `login`; configurator omits it.

Set the Keycloak client's `digit.auth.surface` to the registry key, and use
`digit.auth.signin.methods` and `digit.auth.signup.methods` for ordered method
IDs. A hosted authenticator is declared as `hosted:<id>` and runs in that
client's Keycloak flow. Responses expose `labelKey`; only IdPs expose their
configured display name as `label`.

For delivery, set `IDENTITY_OTP_SENDER=http` and `IDENTITY_OTP_SENDER_URL` to the
internal notification endpoint. `IDENTITY_OTP_SENDER_TIMEOUT_MS` defaults to
10000. Requests contain `{phone, code, purpose, tenantId, locale, expiresIn}`.
2xx succeeds, 429 maps to `OTP_RATE_LIMITED`, and every other transport failure
maps to `OTP_CHANNEL_UNAVAILABLE`. Failed delivery drops the challenge and
refunds the send reservation. `log` remains a development option;
`IDENTITY_CITIZEN_OTP_SENDER` is retained as a fallback environment alias.
