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

1. **Locate Configuration**: Navigate to `novu-bridge/config`. (cd backend/novu-bridge/config)
2. **Edit Environment**: `.env.novu`:
   - `NOVU_BASE_URL`: `http://localhost:3000` (port-forward novu-api on port:3000).
   - `NOVU_API_KEY`: Obtain from Novu Dashboard → **Settings → API Keys** (use the **Dev** environment key).
     > **If the dashboard is not accessible**, retrieve the key via API:
     >
     > **Step 0 — Sign up (first-time only, skip if admin account already exists):**
     > ```bash
     > curl -s -X POST "<NOVU_BASE_URL>/v1/auth/register" \
     >   -H "Content-Type: application/json" \
     >   -d '{
     >     "email": "<novu-admin-email>",
     >     "password": "<novu-admin-password>",
     >     "firstName": "<first-name>",
     >     "lastName": "<last-name>",
     >     "organizationName": "<your-org-name>"
     >   }' | jq -r '.data.token'
     > ```
     > If registration succeeds, the response already contains a token — you can skip Step 1 and use it directly.
     >
     > **Step 1 — Log in to get a user JWT:**
     > ```bash
     > curl -s -X POST "<NOVU_BASE_URL>/v1/auth/login" \
     >   -H "Content-Type: application/json" \
     >   -d '{"email": "<novu-admin-email>", "password": "<novu-admin-password>"}' \
     >   | jq -r '.data.token'
     > ```
     > Save the returned token as `NOVU_USER_TOKEN`.
     >
     > **Step 2 — List environments and extract the API key:**
     > ```bash
     > curl -s -X GET "<NOVU_BASE_URL>/v1/environments" \
     >   -H "Authorization: Bearer <NOVU_USER_TOKEN>" \
     >   | jq -r '.data[] | select(.name == "<your-env-name>") | .apiKeys[0].key'
     > ```
     > The printed value is your `NOVU_API_KEY`. If you only have one environment, replace the `select(...)` filter with `.data[0].apiKeys[0].key`.
   - `TWILIO_ACCOUNT_SID`: From [Twilio Console](https://console.twilio.com) → Account Info.
   - `TWILIO_AUTH_TOKEN`: From the same Twilio Console page.
   - `TWILIO_WHATSAPP_FROM`: Your approved Twilio WhatsApp sender number in the format `whatsapp:+<number>` (e.g. `whatsapp:+14155550123`).
   
3. **Run Bootstrap**: cd backend/novu-bridge/config
   ```bash
   NOVU_ENV_FILE=bash bootstrap-novu-whatsapp.sh
   ```

### Phase 3: Config Service Setup
Config Service acts as the registry for notification metadata. Use your platform's domain URL and provide a valid `authToken` (**Note**: `authtoken` is not required if you are port-forwarding service and in that case your domain url will be `localhost:<port-number>`).

1. **Register Schemas**: Register the required schemas via MDMS v2. Replace `<your-domain>`, `<auth-token>`, and `<user-info>` with values for your environment.

   **NotificationChannel schema:**
   ```bash
   curl -X POST "https://<your-domain>/mdms-v2/schema/v1/_create" \
   -H "Content-Type: application/json" \
   -d '{
     "RequestInfo": {
       "apiId": "Rainmaker",
       "ver": ".01",
       "msgId": "20170310130900|en_IN",
       "authToken": "<auth-token>",
       "userInfo": {
         "id": <user-id>,
         "uuid": "<user-uuid>",
         "userName": "<username>",
         "name": "<name>",
         "type": "EMPLOYEE",
         "roles": [{ "name": "MDMS Admin", "code": "MDMS_ADMIN", "tenantId": "<tenant-id>" }],
         "active": true,
         "tenantId": "<tenant-id>"
       }
     },
     "SchemaDefinition": {
       "tenantId": "DEFAULT",
       "code": "NotificationChannel",
       "description": "Available notification channels and their tenant-level configuration",
       "definition": {
         "type": "object",
         "title": "NotificationChannel",
         "$schema": "http://json-schema.org/draft-07/schema#",
         "required": ["code", "name", "enabled"],
         "x-unique": ["code"],
         "properties": {
           "code": {
             "type": "string",
             "enum": ["WHATSAPP", "SMS", "EMAIL"],
             "description": "Channel identifier"
           },
           "name": { "type": "string", "description": "Human-readable channel name" },
           "enabled": { "type": "boolean", "description": "Whether this channel is active for the tenant" },
           "providerName": { "type": "string", "description": "Provider handling this channel (links to ProviderDetail)" },
           "priority": { "type": "integer", "description": "Dispatch priority (lower = higher priority)" }
         },
         "additionalProperties": true
       },
       "isActive": true
     }
   }'
   ```

   **ProviderDetail schema:**
   ```bash
   curl -X POST "https://<your-domain>/mdms-v2/schema/v1/_create" \
   -H "Content-Type: application/json" \
   -d '{
     "RequestInfo": {
       "apiId": "Rainmaker",
       "ver": ".01",
       "msgId": "20170310130900|en_IN",
       "authToken": "<auth-token>",
       "userInfo": {
         "id": <user-id>,
         "uuid": "<user-uuid>",
         "userName": "<username>",
         "name": "<name>",
         "type": "EMPLOYEE",
         "roles": [{ "name": "MDMS Admin", "code": "MDMS_ADMIN", "tenantId": "<tenant-id>" }],
         "active": true,
         "tenantId": "<tenant-id>"
       }
     },
     "SchemaDefinition": {
       "tenantId": "DEFAULT",
       "code": "ProviderDetail",
       "description": "Notification provider configuration per channel (e.g. Novu WhatsApp credentials)",
       "definition": {
         "type": "object",
         "title": "ProviderDetail",
         "$schema": "http://json-schema.org/draft-07/schema#",
         "required": ["providerName", "channel", "priority"],
         "x-unique": ["providerName", "channel", "priority"],
         "properties": {
           "channel": { "type": "string", "description": "Communication channel (whatsapp, sms, email)" },
           "isActive": { "type": "boolean", "default": true, "description": "Whether this provider is active" },
           "priority": { "type": "integer", "default": 0, "description": "Provider priority (lower = higher priority)" },
           "novuApiKey": { "type": "string", "description": "Optional provider-specific Novu API key" },
           "credentials": { "type": "object", "description": "Provider-specific credentials in Novu-compatible format" },
           "providerName": { "type": "string", "description": "Provider name (e.g., twilio, sendgrid, etc.)" }
         },
         "x-security": ["credentials", "novuApiKey"],
         "description": "Schema for provider configurations per tenant and channel",
         "additionalProperties": true
       },
       "isActive": true
     }
   }'
   ```

   **TemplateBinding schema:**
   ```bash
   curl -X POST "https://<your-domain>/mdms-v2/schema/v1/_create" \
   -H "Content-Type: application/json" \
   -d '{
     "RequestInfo": {
       "apiId": "Rainmaker",
       "ver": ".01",
       "msgId": "20170310130900|en_IN",
       "authToken": "<auth-token>",
       "userInfo": {
         "id": <user-id>,
         "uuid": "<user-uuid>",
         "userName": "<username>",
         "name": "<name>",
         "type": "EMPLOYEE",
         "roles": [{ "name": "MDMS Admin", "code": "MDMS_ADMIN", "tenantId": "<tenant-id>" }],
         "active": true,
         "tenantId": "<tenant-id>"
       }
     },
     "SchemaDefinition": {
       "tenantId": "DEFAULT",
       "code": "TemplateBinding",
       "description": "Binds a workflow event to a Novu template and Twilio content template for WhatsApp dispatch",
       "definition": {
         "type": "object",
         "title": "TemplateBinding",
         "$schema": "http://json-schema.org/draft-07/schema#",
         "required": ["eventName", "channel", "templateId", "locale"],
         "x-unique": ["eventName", "channel", "locale"],
         "properties": {
           "locale": { "type": "string", "default": "en_IN", "pattern": "^[a-z]{2}_[A-Z]{2}$", "description": "Locale code (e.g., en_IN, hi_IN)" },
           "channel": { "type": "string", "description": "Communication channel (whatsapp, sms, email)" },
           "isActive": { "type": "boolean", "default": true, "description": "Whether this template binding is active" },
           "eventName": { "type": "string", "description": "Event name (e.g., COMPLAINTS.WORKFLOW.REJECT)" },
           "contentSid": { "type": "string", "description": "Provider-specific content SID (for Twilio)" },
           "novuApiKey": { "type": "string", "description": "Optional template-specific Novu API key" },
           "paramOrder": { "type": "array", "items": { "type": "string" }, "description": "Order of parameters for template" },
           "templateId": { "type": "string", "description": "Template identifier in Novu" },
           "requiredVars": { "type": "array", "items": { "type": "string" }, "description": "Required variables for template" }
         },
         "x-security": ["novuApiKey"],
         "description": "Schema for template bindings per event and channel"
       },
       "isActive": true
     }
   }'
   ```
2. **Seed Notification Channel**: Register the WHATSAPP channel as an active delivery channel.
   ```bash
   curl -X POST "https://<your-domain>/config-service/config/v1/_create/NotificationChannel" \
   -H "Content-Type: application/json" \
   -d '{
     "RequestInfo": {
       "apiId": "Rainmaker",
       "ver": ".01",
       "msgId": "20170310130900|en_IN",
       "authToken": "<auth-token>",
       "userInfo": {
         "id": <user-id>,
         "uuid": "<user-uuid>",
         "userName": "<username>",
         "name": "<name>",
         "type": "EMPLOYEE",
         "roles": [{ "name": "MDMS Admin", "code": "MDMS_ADMIN", "tenantId": "<tenant-id>" }],
         "active": true,
         "tenantId": "<tenant-id>"
       }
     },
     "configData": {
       "tenantId": "DEFAULT",
       "data": {
         "code": "WHATSAPP",
         "name": "WhatsApp",
         "enabled": true,
         "providerName": "twilio",
         "priority": 1
       }
     }
   }'
   ```

3. **Seed Template Bindings**: Map your Kafka events to Novu workflows. Repeat for each event (APPLY, ASSIGN, REASSIGN, REJECT, RESOLVE, REOPEN, RATE) — change `eventName`, `templateId`, `contentSid`, and `paramOrder` accordingly.
   ```bash
   curl -X POST "https://<your-domain>/config-service/config/v1/_create/TemplateBinding" \
   -H "Content-Type: application/json" \
   -d '{
     "RequestInfo": {
       "apiId": "Rainmaker",
       "authToken": "<auth-token>",
       "userInfo": {
         "id": <user-id>,
         "uuid": "<user-uuid>",
         "userName": "<username>",
         "name": "<name>",
         "type": "CITIZEN",
         "roles": [{ "name": "Citizen", "code": "CITIZEN", "tenantId": "<tenant-id>" }],
         "active": true,
         "tenantId": "<tenant-id>"
       },
       "msgId": "1773829697344|en_IN",
       "plainAccessRequest": {}
     },
     "configData": {
       "tenantId": "DEFAULT",
       "isActive": true,
       "data": {
         "locale": "en_IN",
         "channel": "WHATSAPP",
         "eventName": "COMPLAINTS.WORKFLOW.APPLY",
         "contentSid": "<twilio-content-sid>",
         "novuApiKey": "<novu-api-key>",
         "paramOrder": ["serviceName", "complaintNo", "submittedDate"],
         "templateId": "complaints-workflow-apply",
         "requiredVars": ["complaintNo", "serviceName", "submittedDate"]
       }
     }
   }'
   ```
4. **Seed Provider Credentials**: Store Twilio credentials securely. The `credentials` object holds provider-specific secrets (e.g. Twilio `accountSid` and `authToken`).
   ```bash
   curl -X POST "https://<your-domain>/config-service/config/v1/_create/ProviderDetail" \
   -H "Content-Type: application/json" \
   -d '{
     "RequestInfo": {
       "apiId": "Rainmaker",
       "ver": ".01",
       "msgId": "20170310130900|en_IN",
       "authToken": "<auth-token>",
       "userInfo": {
         "id": <user-id>,
         "uuid": "<user-uuid>",
         "userName": "<username>",
         "name": "<name>",
         "type": "EMPLOYEE",
         "roles": [{ "name": "MDMS Admin", "code": "MDMS_ADMIN", "tenantId": "<tenant-id>" }],
         "active": true,
         "tenantId": "<tenant-id>"
       }
     },
     "configData": {
       "tenantId": "DEFAULT",
       "data": {
         "apiUrl": "https://api.twilio.com/2010-04-01",
         "channel": "WHATSAPP",
         "priority": 1,
         "novuApiKey": "<novu-api-key>",
         "credentials": {
           "accountSid": "<twilio-account-sid>",
           "authToken": "<twilio-auth-token>"
         },
         "providerName": "twilio",
         "senderNumber": "whatsapp:+<twilio-whatsapp-number>"
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
       "tenantId": "<tenantId>",
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
