# XState-Chatbot Service

XState-Chatbot is a chatbot built on [XState](https://xstate.js.org/docs/), a JavaScript implementation of [State-Charts](https://statecharts.github.io).

The chatbot is a backend service: it receives messages incoming from the user, keeps one conversation state per user, and sends replies through a separate API call.

In this project, the `nodejs` directory contains the primary project. It contains all the files of the project that will get deployed on the server. `react-app` is provided only to ease the process of dialog development. It should be used only on a developer's local machine when developing any new chat flow. `nodejs` should be run as a backend service and tested once on the local machine using postman before deploying the build to the server.

For the full design — layers, state kinds, slots, sessions — read [`nodejs/ARCHITECTURE.md`](./nodejs/ARCHITECTURE.md). The sections below are the overview.

## Getting Started

The service needs Node 18 or newer — the test runner uses the built-in `node --test`. The image and CI both build on the version in `nodejs/Dockerfile` (23.9.0 today), so match that if you are chasing a difference between your machine and a pipeline. All commands below run inside `nodejs/`.

```
npm install
cp .env.example .env
npm start
```

The service listens on `SERVICE_PORT` (8082 by default) under `CONTEXT_PATH` (`/xstate-chatbot`). `npm start` runs with `--inspect` for debugging.

If your eGov host serves an incomplete TLS chain, Node will reject it with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`. Fetch the intermediate certificate from the leaf's AIA extension and point `NODE_EXTRA_CA_CERTS` at it yourself — nothing is loaded automatically, and certificates are not committed.

`REPO_PROVIDER` chooses where conversation state lives. `InMemory` keeps sessions in process, so a local run needs no database but loses every conversation on restart. `Postgres` persists them using the `DB_*` settings, and needs the migrations in `nodejs/db/migration/main/` applied first — including `V20260918000000__chat_resume_pending.sql`, without which a resumed session cannot be tracked.

### Configuration

Every tenant- and country-specific value is an environment variable, so the same build serves any deployment. `.env.example` lists the ones a deployment actually sets — `env-variables.js` reads about twice as many, the remainder being dormant config for flows this build does not use (bills, payments, the ValueFirst notification templates). These are the ones you will always set:

| Variable | What it controls |
|---|---|
| `ROOT_TENANTID` | tenant the chatbot files complaints under |
| `SUPPORTED_LOCALES` | locales offered in the language menu |
| `COUNTRY_CODE`, `MOBILE_NUMBER_LENGTH` | number parsing and validation |
| `BOUNDARY_HIERARCHY_TYPE` | which MDMS boundary hierarchy to walk |
| `WHATSAPP_PROVIDER` and the provider's credentials | outbound channel |
| `ALLOWED_MOBILE_NUMBERS` | whitelist gating the welcome step; empty allows all |
| `CANCEL_WORDS`, `RESET_WORDS` | words that cancel or restart a session |
| `TWILIO_VERIFY_WEBHOOK_SIGNATURE`, `TWILIO_WEBHOOK_BASE_URL` | inbound authenticity on Twilio |
| `WEBHOOK_SHARED_SECRET`, `VERIFY_WEBHOOK_SIGNATURE` | inbound authenticity on ValueFirst and Kaleyra |

Four deadlines govern how long anything may take. `REQUEST_TIMEOUT_MS` caps one outbound service call and `MEDIA_PROCESSING_TIMEOUT_MS` caps an attachment fetch; `DISPATCH_SETTLE_TIMEOUT_MS` supervises both and **must stay above them**, or a request and its supervisor expire together and the citizen's lock is released while the call may still be resolving. `REPLY_COOLDOWN_MS` is the pause after a turn settles.

The remaining variables point at the backend services the flow reads from — MDMS, localization, user and PGR. The chatbot is a client of those services; it holds no copy of their data.

### Running the tests

```
npm test
```

`.github/workflows/xstate-chatbot-ci.yml` runs the same command on every push and pull request touching `backend/xstate-chatbot/**`. It asserts `.env` is absent first, because the suite must pass on a clean checkout: a test that silently depends on your local `.env` passes for you and fails for everyone else. If you add one, pin what it needs with `process.env.X = ...` before requiring `env-variables`.

### Wiring it into a local DIGIT stack

The chatbot is not yet part of the compose stack, Kong's route table or the k8s manifests, so a deployment does not start it and nothing routes to it. Until that lands, connect it by hand in two steps.

**1. Run the container on the stack's network.** Build the image from `nodejs/Dockerfile`, then attach it to the network compose created — named `<project>_egov-network`, so `digit_egov-network` for a stack brought up from `~/digit`:

```
docker build -t xstate-chatbot:local .
docker run -d --name xstate-chatbot \
  --network digit_egov-network \
  --env-file .env \
  xstate-chatbot:local
```

The container needs no published port: Kong reaches it over the network by container name. Publish `8082` only if you want to call it directly from the host. Check it joined:

```
docker network inspect digit_egov-network --format '{{range .Containers}}{{.Name}} {{end}}'
```

**2. Add a Kong service and route.** Kong runs DB-less (`KONG_DATABASE: "off"`), reading `local-setup/kong/kong.yml` as a read-only mount, so a route is a file edit plus a restart — not an Admin API call. Add alongside the other services in that file:

```yaml
- name: xstate-chatbot-service
  url: http://xstate-chatbot:8082
  tags:
  - chatbot
  routes:
  - name: xstate-chatbot-route
    paths:
    - /xstate-chatbot
    strip_path: false
```

`strip_path: false` matters: the service mounts its routes under `CONTEXT_PATH` (`/xstate-chatbot`), so stripping the prefix would 404 every request. Then restart Kong to reload the declarative config:

```
docker restart kong-gateway
```

**3. Verify.** Kong's proxy is published on host port 18000, so the inbound webhook is reachable at `http://localhost:18000/xstate-chatbot/message`:

```
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:18000/xstate-chatbot/message
```

Expect **`403`**. That is the success case: Kong matched the route, the service received the request, and it refused an unsigned one. A `404` means Kong did not match the route — check the path and that the restart picked up your edit. A `000` means Kong cannot reach the container, usually the wrong network name.

For a provider to deliver messages, its webhook must point at a publicly reachable URL for that path, which on a local machine means a tunnel.

### Developing a dialogue

`react-app/` renders the conversation in a browser so you can click through a flow without WhatsApp. Run `npm install` in both `nodejs/` and `react-app/`, then `npm start` in `react-app/` and open `http://localhost:3000`. A few environment variables must be disabled first — see [LOCALSETUP.md](./LOCALSETUP.md).

## Flow machine

The dialogue used to be declared in step tables: a data structure describing each step, read by a generator that emitted an XState machine. That worked while the flow was shallow, but every new step kind meant another special case in the generator, and the tables could not express a step that needed its own behaviour.

The flow is now authored as classes. Each state kind (ask a question, show a menu, walk a tree, upload media, confirm) is a class with a known contract, composed into one machine. The onboarding and complaint-filing journeys were ported to these classes, `shell-machine` and `pgr-machine` were merged into a single machine, and the old generator path was removed. Adding a step kind now means adding a class, not editing a generator.

The session layer was split along the same lines: login flows are separate from the chat service that drives the machine.

## Localization and tenancy

Nothing in the dialogue assumes a country or a tenant. The default locale comes from configuration rather than a hardcoded `en_IN`, and the language menu is built from the tenant's own MDMS `StateInfo`, so a deployment offers exactly the languages it has declared. Mobile-number validation is per tenant: the country code and the valid-number rule come from that tenant's MDMS `common-masters.MobileNumberValidation` row, cached briefly, so adding a country is an MDMS edit rather than a redeploy. `DEFAULT_COUNTRY_CODE` and `DEFAULT_MOBILE_REGEX` are the fallback when a tenant has no row — they ship as India's, so a deployment that adds neither the row nor the variables will reject every local number. The outbound sender is the Twilio account's own number and is deliberately not run through the citizen tenant's rule.

Adding a language is an MDMS and localization change; it needs no code edit.

## Complaint filing

Filing walks the complaint hierarchy straight from MDMS, at whatever depth the tenant has configured, showing the chosen path above each menu so the citizen can see where they are. The journey asks for consent before collecting anything, asks which institution the grievance concerns, then collects a description and walks the boundary hierarchy the same way. A review step shows the assembled complaint before submission.

Because both hierarchies come from MDMS, a tenant with three levels and a tenant with five use the same code. The older frequent-complaints shortcut was removed.

## Concurrency and failure handling

A conversation is single-threaded per citizen. Outbound sends are serialized so replies cannot arrive out of order, and the dispatch lock is held through the send plus a short cooldown. A message arriving while the previous one is still being processed is **queued**, not dropped — up to `MAX_QUEUED_MESSAGES_PER_USER`, beyond which further messages are discarded so a citizen tapping repeatedly cannot build a backlog that answers for the next minute. Queues are keyed per conversation, so one slow send never delays anyone else.

Prompts that are deliberately staggered wait inside that same queue rather than on a timer, or they would enqueue after the lock was released and a later reply could overtake the question it answers.

Submitting a complaint is the one step that must not be retried blindly: restoring a state whose invocation is still running re-runs that invocation, so those states are never persisted. If a submission has not settled within `DISPATCH_SETTLE_TIMEOUT_MS` the machine is stopped and the session closed, rather than left resumable at the confirmation prompt where the next "1" would file a second complaint.

An expired session is not silently discarded either: the citizen is asked whether to resume or start over, and that question survives a restart because it lives on the row rather than in process memory.

Media uploads time out instead of hanging the conversation, and oversized attachments are rejected with a retry prompt. Errors are typed exceptions handled in one place, and the citizen sees them in their own language with values drawn from configuration — not a hardcoded English sentence about a digit count from another country.

## Access control

Inbound messages are filtered before any session work happens.

**Authenticity comes first.** Every channel provider must implement `verifyRequest`, and the service refuses to start if the configured one does not — a missing check used to be indistinguishable from a deliberate opt-out, which left three of the four providers wide open. Twilio verifies the `X-Twilio-Signature` HMAC. ValueFirst and Kaleyra sign nothing, so they verify a shared secret sent as `X-Webhook-Secret` (header only — the query form was dropped, because a secret in a url lands in every proxy access log upstream); both **fail closed** when no secret is configured, so an unconfigured deployment rejects traffic loudly instead of accepting it silently. The console provider is exempt on purpose and says so at startup, since it is only selected for local development.

Verification runs *before* the rate limiter, and the limiter counts the signed sender rather than the source address. Keyed on the address it was a denial-of-service lever rather than a defence: behind a tunnel every citizen shares one, so a flood of unsigned requests would have locked everyone out for the rest of the window.

A configurable mobile-number whitelist then gates the welcome step, messages from numbers outside the configured country are dropped, and the reset path does not bypass the whitelist.

Citizen records are provisioned through a service account, so the chatbot files complaints without a citizen ever holding credentials. That account's token is stripped from anything persisted or published — including the event history inside a serialized machine state, where it is easy to miss.

### Operational endpoints

`/reminder` fans a message out to every active session, so it is gated on its own secret rather than a provider signature — no cron or operator can produce one of those. Set `REMINDER_AUTH_TOKEN` and send it as `X-Reminder-Token`; while the variable is unset the route answers 404 and does nothing, which is the safe default for a route nobody has wired up yet.

`/health` returns 200 only when the configuration can actually serve citizens. It returns **503** and names the problems when it cannot — a missing Twilio sender, verification switched off, sessions held in memory. Point the container healthcheck and Gatus at it, so a deployment that boots but drops every reply shows up red instead of green.

## Remote Debugging

`npm start` runs the service under `--inspect`, which listens on 9229. To attach from [VSCode](https://code.visualstudio.com):

1. Port forward from the remote server (`9229:9229`).
2. Add an *Attach to Node* configuration on port 9229 — there is no `.vscode/launch.json` committed here, so create one locally.
3. Start debugging.
