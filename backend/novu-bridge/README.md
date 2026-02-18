# novu-bridge

Local developer guide for running DIGIT `novu-bridge` end-to-end with self-hosted Novu.

## Prerequisites
- Java 17+
- Maven 3.8+
- Docker + Docker Compose
- Running local dependencies used by bridge (Postgres, Kafka/Redpanda, user/config/prefs services as needed)
- Ensure Kafka and Postgres are running either locally or via existing `local-setup/docker-compose*.yml`; then update `backend/novu-bridge/src/main/resources/application.properties` (ports/hosts/credentials) to match your environment.

## 1) Run Novu separately (Docker Compose)
Run Novu in a separate setup/repo using its own Docker Compose.

Official docs:
- https://docs.novu.co/self-hosting/docker-compose

Example:
```bash
# in your Novu docker-compose directory
docker compose up -d
```

Expected local Novu API:
- `http://localhost:3000`

## 2) Configure and bootstrap Novu
Files live under `backend/novu-bridge/config`:
- `bootstrap-novu-whatsapp.sh`
- `.env.novu` (dummy template; replace values)

Update `backend/novu-bridge/config/.env.novu` with real values:
- `NOVU_API_KEY`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_WHATSAPP_FROM`

Then run bootstrap:
```bash
cd backend/novu-bridge/config
./bootstrap-novu-whatsapp.sh
```

This creates/verifies:
- Novu environment
- Twilio integration
- base workflow + event workflows

## 3) Run novu-bridge
From `backend/novu-bridge`:
```bash
mvn spring-boot:run
```

Default local base URL:
- `http://localhost:8290/novu-bridge`

## 4) Test with Postman collection
Collection location:
- `backend/novu-bridge/config/novu-bridge.postman_collection.json`

In Postman, set collection variables:
- `baseUrl`: `http://localhost:8290/novu-bridge`
- `novuBaseUrl`: `http://localhost:3000`
- `novuApiKey`: your real Novu API key
- `twilioContentSid`: your approved Twilio template Content SID (`HX...`)
- `mobileE164`: destination number (default is dummy)
- `templateKey`: active Novu workflow ID

Recommended request order:
1. `Dispatch Validate`
2. `Dispatch Dry Run`
3. `Dispatch Dry Run (send=true)`
4. `Test Trigger (direct Novu)`
5. `Direct Novu Trigger (Twilio ContentSid Override)`

## Notes
- `processed` from Novu means accepted by Novu, not guaranteed handset delivery.
- For WhatsApp outside session window, use Twilio template send (`contentSid` + `contentVariables`).
- Do not commit real secrets into `.env.novu`.
