# Novu Notification System Setup for DIGIT - Bomet County

## Overview
This documentation covers the complete setup of Novu notification system for DIGIT platform, specifically configured for Bomet County's Citizen Complaint Resolution System.

## Architecture Overview

The notification system works through the following flow:
1. **DIGIT Services** (like PGR) publish events to Kafka topics when workflow actions occur
2. **novu-bridge** service listens to these Kafka events
3. **novu-bridge** reads the TemplateBinding configuration from config-service to map events to Novu workflows
4. **novu-bridge** triggers the appropriate Novu workflow via Novu API
5. **Novu** processes the workflow and sends notifications through configured providers (Twilio WhatsApp)

**Two-Part Setup Required:**
1. **In Novu Dashboard**: Create the actual workflows with trigger IDs (complaints-workflow-apply, complaints-workflow-assign, etc.)
2. **In DIGIT Config**: Configure TemplateBinding to map DIGIT events to these Novu workflow trigger IDs

The novu-bridge acts as the integration layer that:
- Maps DIGIT events (COMPLAINTS.WORKFLOW.APPLY) to Novu workflow triggers (complaints-workflow-apply)
- Reads template configurations from config-service
- Triggers the pre-created Novu workflows with the correct parameters

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

### Step 2: Create Workflows in Novu Dashboard

You must create the workflows in Novu before configuring DIGIT. Login to Novu Dashboard and create the following workflows:

#### 2.1 Create "complaints-workflow-apply" Workflow
1. Go to Novu Dashboard → **Workflows**
2. Click **"Create Workflow"**
3. Set Workflow Name: `complaints-workflow-apply`
4. Set Trigger Identifier: `complaints-workflow-apply`
5. Add **Chat** step (for WhatsApp)
6. Select **Twilio** as provider
7. Configure the message template with variables:
   ```
   Your complaint {{complaintNo}} for {{serviceName}} has been submitted on {{submittedDate}}.
   ```
8. Save and **Activate** the workflow

#### 2.2 Create "complaints-workflow-assign" Workflow  
1. Create new workflow with Trigger ID: `complaints-workflow-assign`
2. Add Chat step with Twilio provider
3. Configure message template:
   ```
   Complaint {{complaintNo}} for {{serviceName}} has been assigned to {{assigneeName}} ({{assigneeDesignation}}) from {{departmentName}} department.
   ```
4. Save and Activate

#### 2.3 Create "complaints-workflow-resolve" Workflow
1. Create new workflow with Trigger ID: `complaints-workflow-resolve`
2. Add Chat step with Twilio provider  
3. Configure message template:
   ```
   Your complaint {{complaintNo}} for {{serviceName}} submitted on {{submittedDate}} has been resolved by {{assigneeName}}.
   ```
4. Save and Activate

#### 2.4 Create "complaints-workflow-reject" Workflow
1. Create new workflow with Trigger ID: `complaints-workflow-reject`
2. Add Chat step with Twilio provider
3. Configure message template:
   ```
   Your complaint {{complaintNo}} for {{serviceName}} submitted on {{submittedDate}} has been rejected. Reason: {{comment}}
   ```
4. Save and Activate

**Important:** The Trigger IDs must match exactly with the `templateId` values in the TemplateBinding configuration.

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