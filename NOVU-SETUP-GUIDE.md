# Novu Notification System Setup for DIGIT - Bomet County

## Overview
This documentation covers the complete setup of Novu notification system for DIGIT platform, specifically configured for Bomet County's Citizen Complaint Resolution System.

## Architecture Overview

### Complete Workflow Sync and Execution Flow

#### 1. Workflow Definition & Sync Process

**novu-bridge startup sequence:**
```
1. novu-bridge container starts with Novu Framework
2. Loads workflow definitions from code (@novu/framework)
3. Calls Novu Sync API with NOVU_SECRET_KEY
4. Novu creates/updates workflows in its database
5. Bridge endpoint becomes available for callback
```

**Configuration in novu-bridge:**
```javascript
// novu-bridge environment variables
NOVU_API_KEY=<your-api-key>        // For triggering workflows
NOVU_SECRET_KEY=<your-secret-key>  // For syncing workflows
NOVU_API_URL=http://novu:3000
BRIDGE_ENDPOINT=http://novu-bridge:4000/api/novu

// Framework initialization
import { serve } from '@novu/framework/express';
import { ALL_WORKFLOWS } from './workflows.js';

// Sync happens here - uploads workflows to Novu
app.use('/api/novu', serve({ 
  workflows: ALL_WORKFLOWS,
  secretKey: process.env.NOVU_SECRET_KEY
}));
```

#### 2. Runtime Event Flow

```mermaid
DIGIT Service → Kafka Event → novu-bridge → Novu API → Bridge Callback → Provider
```

**Detailed steps:**
1. **PGR Service** publishes `COMPLAINTS.WORKFLOW.APPLY` to Kafka
2. **novu-bridge** consumes event, reads TemplateBinding from config-service
3. **novu-bridge** calls Novu: `POST /v1/events/trigger`
   ```json
   {
     "name": "complaints-workflow-apply",
     "to": { "subscriberId": "user-123" },
     "payload": { "complaintNo": "PGR-001", ... }
   }
   ```
4. **Novu** executes workflow, calls back to bridge: `POST /api/novu`
5. **Bridge** renders message body using payload data
6. **Novu** sends via Twilio WhatsApp

#### 3. Key Components

**Novu Framework Workflows** (in novu-bridge):
- Define workflow structure and steps
- Auto-sync on bridge startup
- Handle message rendering

**TemplateBinding** (in config-service):
- Maps DIGIT events to Novu workflow IDs
- Contains Twilio content SIDs
- Defines required variables

**Bridge Endpoint**:
- Receives callback from Novu
- Renders dynamic message content
- Returns formatted message to Novu

## Prerequisites

### Required Services
- Docker and Docker Compose installed
- DIGIT platform running (especially config-service)
- Novu instance deployed and accessible
- Twilio account with WhatsApp Business API access

### Environment URLs
```bash
CONFIG_SERVICE_URL=http://localhost:18000
NOVU_API_URL=http://localhost:14002
TENANT_ID=be.bomet
```

## Step-by-Step Setup Guide

### Step 1: Obtain Required Credentials

#### Novu API Key
1. Access Novu Dashboard at `http://localhost:14002`
2. If not already logged in, create an account or login
3. Once logged in, click on the **Settings** icon (gear icon) in the left sidebar
4. Navigate to **API Keys** section
5. You'll see your environments listed (Development/Production)
6. Click on the **Copy** button next to the API key for your environment
7. Save this API key securely - you'll need it for the NOVU_API_KEY variable

**Note:** If you don't see an API key:
- Click on **"Generate API Key"** button
- Give it a descriptive name (e.g., "DIGIT Integration")
- Copy the generated key immediately (it won't be shown again)

#### Twilio Credentials
1. Log into Twilio Console
2. Get Account SID and Auth Token from dashboard
3. Set up WhatsApp sender number (format: `whatsapp:+91XXXXXXXXXX`)

### Step 2: Configure novu-bridge for Workflow Sync

#### Required Environment Variables for novu-bridge

Add these to your docker-compose or .env file:

```yaml
novu-bridge:
  environment:
    # Novu API credentials
    NOVU_API_KEY: "your-api-key"      # From Novu Dashboard
    NOVU_SECRET_KEY: "your-secret"    # From Novu Dashboard (Settings → API Keys)
    NOVU_API_URL: "http://novu:3000"  # Novu service URL
    
    # Bridge configuration
    BRIDGE_ENDPOINT: "http://novu-bridge:4000/api/novu"
    PORT: 4000
    
    # Kafka configuration
    KAFKA_BROKERS: "kafka:9092"
    KAFKA_TOPIC: "complaints.domain.events"
    
    # Config service
    CONFIG_SERVICE_URL: "http://digit-config-service:8080"
```

#### How Workflow Sync Works

1. **On novu-bridge startup:**
   ```javascript
   // novu-bridge automatically calls this on startup
   POST https://novu-api/v1/bridge/sync
   Headers: { 
     'Authorization': 'ApiKey ${NOVU_SECRET_KEY}',
     'Novu-Framework-Secret': '${NOVU_SECRET_KEY}'
   }
   Body: {
     bridgeUrl: 'http://novu-bridge:4000/api/novu',
     workflows: [...] // All workflow definitions
   }
   ```

2. **Novu processes the sync:**
   - Creates new workflows if they don't exist
   - Updates existing workflows with new definitions
   - Stores bridge URL for callbacks
   - Returns sync status

3. **Verification:**
   ```bash
   # Check if workflows are synced
   curl http://localhost:14002/v1/workflows \
     -H "Authorization: ApiKey YOUR_API_KEY"
   
   # Should see workflows like:
   # - complaints-workflow-apply
   # - complaints-workflow-assign
   # - complaints-workflow-resolve
   # - complaints-workflow-reject
   ```

#### Workflow Code Structure in novu-bridge

```javascript
// /app/workflows.js
import { workflow } from '@novu/framework';

// Define workflow with WhatsApp/SMS steps
export const complaintsApply = workflow(
  'complaints-workflow-apply',  // Workflow ID (must match TemplateBinding)
  async ({ step, payload }) => {
    // SMS step
    await step.sms('send-sms', async () => ({
      body: renderSmsTemplate(payload)
    }));
    
    // WhatsApp step (if configured)
    await step.chat('send-whatsapp', async () => ({
      body: renderWhatsAppTemplate(payload)
    }));
  },
  {
    name: 'COMPLAINTS WORKFLOW APPLY',
    payloadSchema: { type: 'object' }
  }
);

// Export all workflows for sync
export const ALL_WORKFLOWS = [
  complaintsApply,
  complaintsAssign,
  complaintsResolve,
  complaintsReject
];
```

**Important Notes:**
- NOVU_SECRET_KEY is different from NOVU_API_KEY
- Workflows sync automatically on bridge startup
- Bridge must be accessible by Novu for callbacks
- Workflow IDs in code must match TemplateBinding templateIds

### Step 3: Configure Environment Variables

Create `.env` file or export these variables:
```bash
export NOVU_API_KEY="your-novu-api-key-here"
export TWILIO_ACCOUNT_SID="your-twilio-account-sid"
export TWILIO_AUTH_TOKEN="your-twilio-auth-token"
export TWILIO_WHATSAPP_FROM="whatsapp:+91XXXXXXXXXX"
```

### Step 3: Create Configuration Schemas

The system requires three main schemas in config-service:

#### 3.1 TemplateBinding Schema
```json
{
  "code": "TemplateBinding",
  "description": "Event to notification template mapping",
  "definition": {
    "type": "object",
    "title": "TemplateBinding"
  },
  "isActive": true
}
```

#### 3.2 ProviderDetail Schema
```json
{
  "code": "ProviderDetail",
  "description": "Notification provider configuration",
  "definition": {
    "type": "object",
    "title": "ProviderDetail"
  },
  "isActive": true
}
```

#### 3.3 NotificationChannel Schema
```json
{
  "code": "NotificationChannel",
  "description": "Notification channel configuration",
  "definition": {
    "type": "object",
    "title": "NotificationChannel"
  },
  "isActive": true
}
```

### Step 4: Configure Provider Details

Create Twilio WhatsApp provider configuration:

```json
{
  "apiUrl": "https://api.twilio.com/2010-04-01",
  "channel": "WHATSAPP",
  "priority": 1,
  "tenantId": "be.bomet",
  "novuApiKey": "<NOVU_API_KEY>",
  "credentials": {
    "from": "whatsapp:+91XXXXXXXXXX",
    "authToken": "<TWILIO_AUTH_TOKEN>",
    "accountSid": "<TWILIO_ACCOUNT_SID>"
  },
  "providerName": "Twilio",
  "senderNumber": "whatsapp:+91XXXXXXXXXX"
}
```

**Unique Identifier:** `Twilio.whatsapp.1`

### Step 5: Configure Notification Channel

```json
{
  "code": "WHATSAPP",
  "name": "WhatsApp",
  "enabled": true,
  "providerName": "Twilio",
  "priority": 1
}
```

**Unique Identifier:** `NotificationChannel.WHATSAPP.be.bomet`

### Step 6: Configure Template Bindings

Each complaint workflow event needs a template binding:

#### 6.1 COMPLAINTS.WORKFLOW.APPLY
```json
{
  "locale": "en_IN",
  "channel": "WHATSAPP",
  "tenantId": "be.bomet",
  "eventName": "COMPLAINTS.WORKFLOW.APPLY",
  "contentSid": "HX350aa0b139780ea87f554276b1f68d6c",
  "novuApiKey": "<NOVU_API_KEY>",
  "paramOrder": ["serviceName", "complaintNo", "submittedDate"],
  "templateId": "complaints-workflow-apply",
  "requiredVars": ["complaintNo", "serviceName", "submittedDate"]
}
```
**Unique ID:** `COMPLAINTS.WORKFLOW.APPLY.WHATSAPP.en_IN`

#### 6.2 COMPLAINTS.WORKFLOW.ASSIGN
```json
{
  "locale": "en_IN",
  "channel": "WHATSAPP",
  "tenantId": "be.bomet",
  "eventName": "COMPLAINTS.WORKFLOW.ASSIGN",
  "contentSid": "HX158f8edc7079e2c2b76d9c8f68e87791",
  "novuApiKey": "<NOVU_API_KEY>",
  "paramOrder": ["serviceName", "complaintNo", "submittedDate", "assigneeName", "assigneeDesignation", "departmentName"],
  "templateId": "complaints-workflow-assign",
  "requiredVars": ["complaintNo", "status", "serviceName", "departmentName", "submittedDate"]
}
```
**Unique ID:** `COMPLAINTS.WORKFLOW.ASSIGN.WHATSAPP.en_IN`

#### 6.3 COMPLAINTS.WORKFLOW.RESOLVE
```json
{
  "locale": "en_IN",
  "channel": "WHATSAPP",
  "tenantId": "be.bomet",
  "eventName": "COMPLAINTS.WORKFLOW.RESOLVE",
  "contentSid": "HX065a203bccd1c6485050624fafcb6890",
  "novuApiKey": "<NOVU_API_KEY>",
  "paramOrder": ["serviceName", "complaintNo", "submittedDate", "assigneeName"],
  "templateId": "complaints-workflow-resolve",
  "requiredVars": ["serviceName", "complaintNo", "submittedDate", "assigneeName"]
}
```
**Unique ID:** `COMPLAINTS.WORKFLOW.RESOLVE.WHATSAPP.en_IN`

#### 6.4 COMPLAINTS.WORKFLOW.REJECT
```json
{
  "locale": "en_IN",
  "channel": "WHATSAPP",
  "tenantId": "be.bomet",
  "eventName": "COMPLAINTS.WORKFLOW.REJECT",
  "contentSid": "HX5cf9ba4ee941ea005268bef804094dff",
  "novuApiKey": "<NOVU_API_KEY>",
  "paramOrder": ["serviceName", "complaintNo", "submittedDate", "comment"],
  "templateId": "complaints-workflow-reject",
  "requiredVars": ["complaintNo", "serviceName", "submittedDate", "comment"]
}
```
**Unique ID:** `COMPLAINTS.WORKFLOW.REJECT.WHATSAPP.en_IN`

## API Endpoints for Configuration

### Create Schema
```bash
POST http://localhost:18000/config-service/schema/v1/_create
```

### Create Configuration
```bash
POST http://localhost:18000/config-service/config/v1/_create/{schemaCode}
```

### Update Configuration
```bash
POST http://localhost:18000/config-service/config/v1/_update/{schemaCode}
```

### Search Configuration
```bash
POST http://localhost:18000/config-service/config/v1/_search
```

## Automated Setup Script

Save the provided script as `novu-setup.sh` and run:
```bash
chmod +x novu-setup.sh
./novu-setup.sh
```

## Service Management

### Restart Services After Configuration
```bash
docker restart digit-config-service
docker restart novu-bridge
```

### Check Service Logs
```bash
# Config service logs
docker logs -f digit-config-service

# Novu bridge logs
docker logs -f novu-bridge

# Check last 50 lines
docker logs novu-bridge --tail 50
```

## novu-bridge Endpoints

The novu-bridge service exposes endpoints for workflow management:

### Trigger Workflow Manually
```bash
POST http://localhost:8085/novu/workflow/trigger
Content-Type: application/json

{
  "eventName": "COMPLAINTS.WORKFLOW.APPLY",
  "tenantId": "be.bomet",
  "locale": "en_IN",
  "channel": "WHATSAPP",
  "recipient": {
    "mobileNumber": "+254XXXXXXXXX",
    "name": "John Doe"
  },
  "payload": {
    "complaintNo": "PGR/2024/000001",
    "serviceName": "Streetlight",
    "submittedDate": "2024-01-15"
  }
}
```

### Health Check
```bash
GET http://localhost:8085/health
```

## Verification Steps

### 1. Verify API Key
```bash
curl -s "http://localhost:14002/v1/environments/api-keys" \
  -H "Authorization: ApiKey YOUR_NOVU_API_KEY"
```

### 2. Verify Template Bindings
```bash
curl -s "http://localhost:18000/config-service/config/v1/_search" \
  -H "Content-Type: application/json" \
  -d '{
    "RequestInfo": {"apiId": "test"},
    "criteria": {
      "tenantId": "be.bomet",
      "schemaCode": "TemplateBinding"
    }
  }'
```

### 3. Test Notification Flow
1. Create a test complaint in the system
2. Monitor novu-bridge logs for processing
3. Check WhatsApp for received notification

## Troubleshooting

### Common Issues and Solutions

#### Issue: Invalid Novu API Key
- **Solution:** Regenerate API key from Novu dashboard
- Ensure key is for correct environment (dev/prod)

#### Issue: WhatsApp Messages Not Sending
- **Check:** Twilio credentials are correct
- **Verify:** WhatsApp sender number is approved
- **Ensure:** Recipient number is opted-in for WhatsApp business messages

#### Issue: Template Not Found
- **Verify:** Content SID matches Twilio template
- **Check:** Template is approved in Twilio console
- **Ensure:** All required variables are present

#### Issue: Config Service Not Loading
- **Clear cache:** Restart config-service
- **Check logs:** `docker logs digit-config-service`
- **Verify:** Schema exists before creating config

## Environment-Specific Configurations

### Development
```bash
CONFIG_SERVICE_URL=http://localhost:18000
NOVU_API_URL=http://localhost:14002
```

### Production
```bash
CONFIG_SERVICE_URL=https://config.bomet.go.ke
NOVU_API_URL=https://novu.bomet.go.ke
```

## Security Best Practices

1. **Never commit credentials** to version control
2. Use environment variables or secrets management
3. Rotate API keys regularly
4. Restrict Novu API key permissions to minimum required
5. Use HTTPS in production environments

## Monitoring and Maintenance

### Health Checks
```bash
# Check Novu health
curl http://localhost:14002/health

# Check config-service health
curl http://localhost:18000/health
```

### Regular Tasks
- Monitor notification delivery rates
- Check for failed notifications in Novu dashboard
- Review and update templates as needed
- Keep Twilio balance topped up

## Support and Resources

- **Novu Documentation:** https://docs.novu.co
- **Twilio WhatsApp API:** https://www.twilio.com/docs/whatsapp
- **DIGIT Documentation:** https://digit.org/platform/docs

## Notes
- All configurations are tenant-specific (be.bomet)
- WhatsApp requires pre-approved message templates
- Ensure proper opt-in for WhatsApp recipients
- Test thoroughly in development before production deployment