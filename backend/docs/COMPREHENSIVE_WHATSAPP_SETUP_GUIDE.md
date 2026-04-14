# Comprehensive WhatsApp Service Setup Guide

This guide provides step-by-step instructions for setting up the end-to-end WhatsApp notification ecosystem, including the Novu infrastructure and the DIGIT platform services.

For detailed information on Role-Based Access Control (RBAC) and cluster-level deployment, see [WhatsApp Notification Setup Guide](WHATSAPP_NOTIFICATION_SETUP.md).

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

## 3. Role and Access Control

To ensure secure access to notification APIs, a new role `CONFIG_ADMIN` is required.

- **Role**: `CONFIG_ADMIN`
- **Responsibilities**: Manage template bindings, provider credentials, and user preferences.
- **Assignment**: This role should be mapped to the `SUPERADMIN` user by default.
- **Detailed API Mappings**: Refer to the [Setup Guide](WHATSAPP_NOTIFICATION_SETUP.md#1-role-and-access-control).

---

## 4. Step-by-Step Setup

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
   - `NOVU_BASE_URL`: Usually `http://novu-api.novu:3000` (internal) or `https://<domain>/novu-api` (external).
   - `NOVU_API_KEY`: Obtain from Novu Dashboard (Settings -> API Keys).
   - `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM`.
3. **Run Bootstrap**:
   ```bash
   NOVU_ENV_FILE=.env.novu.local bash bootstrap-novu-whatsapp.sh
   ```

### Phase 3: Config Service Setup
Config Service acts as the registry for notification metadata. Use your platform's domain URL and provide a valid `authToken`.

1. **Register Schemas**: Register `TemplateBinding` and `ProviderDetail` schemas via MDMS v2 (see [Setup Guide](WHATSAPP_NOTIFICATION_SETUP.md#3-data-loading-via-domain-url) for details).
2. **Seed Template Bindings**: Map your Kafka events to Novu workflows.
   ```bash
   curl -X POST "https://<your-domain>/config-service/config/v1/_create/TemplateBinding" \
   -H "Content-Type: application/json" \
   -d '{
     "requestInfo": { "authToken": "<your-auth-token>" },
     "configData": {
       "tenantId": "pb",
       "uniqueIdentifier": "COMPLAINTS.WORKFLOW.APPLY",
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
   curl -X POST "https://<your-domain>/config-service/config/v1/_create/ProviderDetail" \
   -H "Content-Type: application/json" \
   -d '{
     "requestInfo": { "authToken": "<your-auth-token>" },
     "configData": {
       "tenantId": "pb",
       "uniqueIdentifier": "twilio-whatsapp",
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

1. **Enable WhatsApp Channel**: Create a preference for the user using the `_upsert` endpoint.
   ```bash
   curl -X POST "https://<your-domain>/user-preference/v1/_upsert" \
   -H "Content-Type: application/json" \
   -d '{
     "requestInfo": { "authToken": "<your-auth-token>" },
     "preference": {
       "userId": "<user-uuid>",
       "tenantId": "pb",
       "preferenceCode": "USER_NOTIFICATION_PREFERENCES",
       "payload": {
         "preferredLanguage": "en_IN",
         "consent": { "WHATSAPP": { "status": "GRANTED", "scope": "GLOBAL" } }
       }
     }
   }'
   ```

### Phase 5: Novu Bridge Deployment
Configure Novu Bridge to connect all pieces. In a cluster environment, use internal DNS names for service discovery.

1. **Key Properties**:
   - `spring.kafka.bootstrap-servers`: Kafka broker address.
   - `novu.bridge.kafka.input.topic`: Topic where domain events are published.
   - `novu.bridge.config.host`: `http://digit-config-service.digit:8080`
   - `novu.bridge.preference.host`: `http://digit-user-preferences-service.digit:8080/user-preference`
   - `novu.base.url`: `http://novu-api.novu:3000`
   - `novu.api.key`: Novu API Key.

---

## 5. Verification

### Dry Run Validation
Test the entire pipeline (config resolution + consent check) without sending a real message:
```bash
curl -X POST "https://<your-domain>/novu-bridge/novu-adapter/v1/dispatch/_validate" \
  -H "Content-Type: application/json" \
  -d '{
    "requestInfo": { "authToken": "<your-auth-token>" },
    "event": { ...domain event... }
  }'
```

### Direct Trigger
Test Novu + Twilio integration directly:
```bash
curl -X POST "https://<your-domain>/novu-bridge/novu-adapter/v1/dispatch/_test-trigger" \
  -H "Content-Type: application/json" \
  -d '{
    "requestInfo": { "authToken": "<your-auth-token>" },
    "templateKey": "complaints-whatsapp-v1",
    "phone": "whatsapp:+91...",
    "contentSid": "HX...",
    "contentVariables": { "1": "Jane Doe", "2": "CMP-123" }
  }'
```

---

## 6. Troubleshooting

- **Check Logs**:
   - Novu Bridge: `kubectl logs -l app=novu-bridge`
   - Novu Worker: `kubectl logs -n novu -l app=novu-worker`
- **Audit Table**: Query `nb_dispatch_log` in the `egov` database to see the status of every event processed by the bridge.
- **Novu Dashboard**: Check the "Activity Feed" in the Novu UI to see if triggers reached the API.
