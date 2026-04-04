# Comprehensive WhatsApp Service Setup Guide

This guide provides step-by-step instructions for setting up the end-to-end WhatsApp notification ecosystem, including the Novu infrastructure and the DIGIT platform services.

---

## 1. System Architecture

The WhatsApp notification flow follows this path:
1. **Source Module**: Publishes a `DomainEvent` to a Kafka topic.
2. **Novu Bridge**: Consumes the event, checks user consent via **User Preference Service**, resolves template/provider via **Config Service**, and triggers **Novu**.
3. **Novu Infrastructure**: Orchestrates the delivery using the **Twilio** provider.
4. **Twilio**: Delivers the message to the end user's WhatsApp.

---

## 2. Component Overview

| Component | Service Name | Role |
|-----------|--------------|------|
| **Novu API** | `novu-api` | Core orchestration engine |
| **Novu Dashboard** | `novu-dashboard` | UI for managing workflows and integrations |
| **Novu Worker** | `novu-worker` | Handles background jobs and triggers |
| **Novu WS** | `novu-ws` | WebSocket server for real-time updates |
| **Novu Data** | `mongodb`, `redis` | Persistence and caching for Novu |
| **Config Service** | `digit-config-service` | Stores template mappings and provider credentials |
| **User Preference** | `digit-user-preferences-service` | Manages user consent for WhatsApp |
| **Novu Bridge** | `novu-bridge` | Integration logic and Kafka consumer |

---

## 3. Step-by-Step Setup

### Phase 1: Novu Infrastructure Verification
Ensure all Novu components are running in your cluster.
```bash
kubectl get pods -n novu
```
You should see `novu-api`, `novu-dashboard`, `novu-worker`, `novu-ws`, `novu-mongodb`, and `novu-redis` in `Running` status.

### Phase 2: Bootstrap Novu Logical Setup
This step configures the Novu environment, creates the Twilio integration, and sets up workflows.

1. **Locate Configuration**: Navigate to `novu-bridge/config`.
2. **Edit Environment**: Copy `.env.novu` to `.env.novu.local` and fill in:
   - `NOVU_BASE_URL`: Usually `http://novu-api.novu:3000` or local forward.
   - `NOVU_API_KEY`: Obtain from Novu Dashboard (Settings -> API Keys).
   - `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`.
3. **Run Bootstrap**:
   ```bash
   NOVU_ENV_FILE=.env.novu.local bash bootstrap-novu-whatsapp.sh
   ```

### Phase 3: Config Service Setup
Config Service acts as the registry for notification metadata.

1. **Register Schemas**: Register `TemplateBinding` and `ProviderDetail` schemas via MDMS v2 (see `docs/WHATSAPP_NOTIFICATION_SETUP.md` Step 3 for details).
2. **Seed Template Bindings**: Map your Kafka events to Novu workflows.
   ```bash
   curl -X POST "http://config-service/config/v1/_create/TemplateBinding" -d '{
     "configData": {
       "data": {
         "eventName": "COMPLAINTS.WORKFLOW.APPLY",
         "templateId": "complaints-whatsapp-v1",
         "contentSid": "HX...",
         "paramOrder": ["citizenName", "complaintNo"]
       }
     }
   }'
   ```
3. **Seed Provider Credentials**: Store Twilio credentials securely.
   ```bash
   curl -X POST "http://config-service/config/v1/_create/ProviderDetail" -d '{
     "configData": {
       "data": {
         "providerName": "twilio",
         "channel": "whatsapp",
         "credentials": { "accountSid": "AC...", "authToken": "..." }
       }
     }
   }'
   ```

### Phase 4: User Preference Service Setup
Novu Bridge will skip notifications if consent is not granted.

1. **Enable WhatsApp Channel**: Create a preference for the user.
   ```bash
   curl -X POST "http://user-preference/v1/_create" -d '{
     "preference": {
       "userId": "<user-uuid>",
       "channels": { "WHATSAPP": { "consent": "GRANTED" } }
     }
   }'
   ```
   *Note: Set `novu.bridge.preference.enabled=false` in Novu Bridge to bypass this check during dev.*

### Phase 5: Novu Bridge Deployment
Configure Novu Bridge to connect all pieces.

1. **Key Properties**:
   - `spring.kafka.bootstrap-servers`: Kafka broker address.
   - `novu.bridge.kafka.input.topic`: Topic where domain events are published.
   - `novu.bridge.config.host`: URL of Config Service.
   - `novu.bridge.preference.host`: URL of User Preference Service.
   - `novu.base.url`: URL of Novu API.
   - `novu.api.key`: Novu API Key.

2. **Run Service**:
   ```bash
   java -jar novu-bridge.jar --novu.api.key=${NOVU_API_KEY}
   ```

---

## 4. Verification

### Dry Run Validation
Test the entire pipeline (config resolution + consent check) without sending a real message:
```bash
curl -X POST "http://novu-bridge/novu-adapter/v1/dispatch/_validate" \
  -H "Content-Type: application/json" \
  -d @domain-event.json
```

### Direct Trigger
Test Novu + Twilio integration directly:
```bash
curl -X POST "http://novu-bridge/novu-adapter/v1/dispatch/_test-trigger" \
  -d '{
    "templateKey": "complaints-whatsapp-v1",
    "phone": "whatsapp:+91...",
    "contentSid": "HX...",
    "contentVariables": { "1": "Jane Doe", "2": "CMP-123" }
  }'
```

---

## 5. Troubleshooting

- **Check Logs**: 
  - Novu Bridge: `kubectl logs -l app=novu-bridge`
  - Novu Worker: `kubectl logs -n novu -l app=novu-worker`
- **Audit Table**: Query `nb_dispatch_log` in the `egov` database to see the status of every event processed by the bridge.
- **Novu Dashboard**: Check the "Activity Feed" in the Novu UI to see if triggers reached the API.
