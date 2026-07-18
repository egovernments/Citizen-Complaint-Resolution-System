# Ozeki gateway probe — R1/R3 gate results (2026-07-18)

Probes from `OZEKI-GENERIC-SMS-PROVIDER.md` §4/§5, run against a real trial
**Ozeki SMS Gateway 10.4.16** (vendor Linux .deb in an Ubuntu 22.04/mono
container, amd64; HTTP API user created via the gateway GUI; no SMS route
installed — probes verify API parse/response behavior, which is all the R1/R3
gates require).

## R1 — leak-through tolerance: **PASS**

Request (exactly what Novu generic-sms will emit — our `_passthrough`
`messages[]` plus the unavoidable top-level leak-through fields):

```
POST /api?action=sendmsg
Authorization: Basic base64(apiuser:******)
Content-Type: application/json

{"to":"+254700000001","content":"Complaint KE-123 status update","sender":"EGOV",
 "id":"novu-msg-id-1","customData":{},
 "messages":[{"message_id":"txn-r1-0001","to_address":"+254700000001",
              "text":"Complaint KE-123 status update"}]}
```

Response — HTTP 200, byte-identical in shape to the clean-envelope control
(same run, `messages[]` only):

```json
{"http_code":200,"response_code":"SUCCESS","response_msg":"Messages queued for delivery.",
 "data":{"total_count":1,"success_count":1,"failed_count":0,
  "messages":[{"message_id":"txn-r1-0001","from_station":"%","to_address":"+254700000001",
   "to_station":"%","text":"Complaint KE-123 status update",
   "create_date":"2026-07-18 08:45:49","valid_until":"2026-07-25 08:45:49",
   "time_to_send":"2026-07-18 08:45:49","submit_report_requested":true,
   "delivery_report_requested":false,"view_report_requested":false,
   "tags":[{"name":"Type","value":"SMS:TEXT"}],"status":"SUCCESS"}]}}
```

Conclusions:
- Unknown top-level fields are **ignored** — no shim or fork needed.
- `message_id` is echoed at `data.messages.0.message_id`, validating the
  integration's `idPath` credential exactly as designed.
- `valid_until` defaults to now+7d; `delivery_report_requested` defaults false.

## R3 — auth failure behavior: **ANSWERED**

Wrong password → **HTTP 200** (not 401) with a *different* envelope:

```json
{"response":{"action":"commandresult","data":{"errorcode":1157,"errormessage":"Invalid username or password"}}}
```

Consequence for the design: generic-sms resolves `idPath`
(`data.messages.0.message_id`) with a dot-path reduce; on this envelope
`data.messages` is absent, the reduce throws, and Novu marks the message
**failed**. Auth failures therefore surface as failures despite the 200 —
the accidental guard described in the design doc §2 is confirmed real.

## Can the trial gateway be a standing CI check? — assessed, NO

Technically it works (the container builds on amd64, boots headless in ~8s,
and a GUI-provisioned `/var/lib/ozeki/Data` could be baked into a reusable
image). But the trial license is time-limited (7–14 days) and mangles every
6th message to "Ozeki SMS Trial"; a CI job that perpetually reinstalls or
rebakes a trial to keep it fresh would be circumventing the trial terms, and
an aging baked image rots the check. So:
- the **real-gateway probe stays a one-time/per-deployment step** (rerun the
  two curls above against the customer's licensed gateway before enabling);
- the **responses recorded here are the canonical fixtures** for any future
  mock-based contract test in CI.
