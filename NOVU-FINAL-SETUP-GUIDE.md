# Complete Novu Notification System Setup Guide - DIGIT CCRS Bomet
## With Full Architecture Understanding

---

## Table of Contents
1. [Architecture Overview](#1-architecture-overview)
2. [Prerequisites](#2-prerequisites)
3. [Step 1: Enable Novu in Configuration](#step-1-enable-novu-in-configuration)
4. [Step 2: Create Novu Account](#step-2-create-novu-account)
5. [Step 3: Setup Twilio](#step-3-setup-twilio)
6. [Step 4: Configure Credentials](#step-4-configure-credentials)
7. [Step 5: Deploy and Bootstrap](#step-5-deploy-and-bootstrap)
8. [Step 6: Understanding Workflows](#step-6-understanding-workflows)
9. [Step 7: Adding Custom Workflows](#step-7-adding-custom-workflows)
10. [Verification & Testing](#verification--testing)
11. [Troubleshooting](#troubleshooting)

---

## 1. Architecture Overview

### Complete System Architecture

The Novu notification system in DIGIT consists of THREE key components:

```
┌─────────────────────────────────────────────────────────────────┐
│                        ARCHITECTURE FLOW                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  1. PGR Service → Kafka Event → novu-bridge (Java)              │
│                                       ↓                          │
│                              Reads TemplateBinding               │
│                              Gets workflow ID & vars             │
│                                       ↓                          │
│  2. novu-bridge → Triggers Novu API with workflow ID            │
│                                       ↓                          │
│  3. Novu → Calls novu-bridge-endpoint (Node.js)                 │
│                                       ↓                          │
│  4. novu-bridge-endpoint → Renders message using workflows.js    │
│                                       ↓                          │
│  5. Novu → Sends via Twilio WhatsApp/SMS                        │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Language | Purpose | Location |
|-----------|----------|---------|----------|
| **novu-bridge** | Java | Consumes Kafka events, triggers Novu workflows | `backend/novu-bridge/` |
| **novu-bridge-endpoint** | Node.js | Defines workflows, renders messages | `backend/novu-bridge-endpoint/` |
| **Novu Platform** | External | Orchestrates notifications, calls providers | Docker containers |

### Key Understanding Points

1. **Workflows are defined** in `backend/novu-bridge-endpoint/workflows.js`
2. **Workflows are synced** to your Novu account via NOVU_SECRET_KEY
3. **Events trigger workflows** via novu-bridge using workflow IDs from TemplateBinding
4. **Messages are rendered** when Novu calls back to novu-bridge-endpoint

---

## 2. Prerequisites

### System Requirements
- [ ] Docker and Docker Compose installed
- [ ] DIGIT platform deployed (at least core services)
- [ ] Port 14002 available for Novu API
- [ ] Port 4000 available for novu-bridge-endpoint

### Accounts Needed
- [ ] Email for Novu account creation
- [ ] Twilio account with WhatsApp capability
- [ ] Credit card for Twilio ($20 minimum)

---

## Step 1: Enable Novu in Configuration

### 1.1 Edit Bomet Configuration File

```bash
cd local-setup/ansible/inventory/host_vars/
nano bomet.yml
```

### 1.2 Set Novu Flag to True

Find and update this line:
```yaml
enable_novu: true  # This enables the notifications profile in Docker Compose
```

This flag does the following:
- Includes the `notifications` profile in Docker Compose
- Starts Novu containers (API, Worker, Web, etc.)
- Starts novu-bridge and novu-bridge-endpoint services
- Runs bootstrap scripts if credentials are provided

---

## Step 2: Create Novu Account

### 2.1 First Deploy (Without Credentials)

Run initial deployment to start Novu services:
```bash
cd local-setup/ansible
./deploy.sh bomet
```

This will:
- Start all Novu containers
- Make Novu dashboard available at `http://localhost/novu/`
- Show a message about missing API keys (expected)

### 2.2 Access Novu Dashboard

1. Open browser: `http://localhost/novu/` or `https://yourdomain/novu/`
2. **First user signup creates the organization**
3. Sign up with:
   - Email: your-email@example.com
   - Password: Strong password
   - Organization: "Bomet County" or your org name

### 2.3 Get Your API Keys

After signup:

1. **Click Settings** (gear icon) → **API Keys**
2. You'll see TWO important keys:

   **API Key** (for triggering notifications):
   ```
   Example: nv_2fH8Kj9Lm3Qr5Tx7Vz9Bc2Df4Gh6Jk
   ```

   **Secret Key** (for syncing workflows):
   ```
   Example: nv_secret_aB3dE5fG7hI9jK1lM3nO5pQ7rS9tU1vW3xY5zA7
   ```

3. **COPY BOTH KEYS** - you'll need them in Step 4

### Important: How Keys Link to Your Account

- **API Key**: Identifies YOUR Novu account when triggering notifications
- **Secret Key**: Identifies YOUR account when syncing workflows from code
- Workflows synced with Bomet's secret key ONLY appear in Bomet's account
- No other organization can see or use your workflows

---

## Step 3: Setup Twilio

### 3.1 Create Twilio Account

1. Go to: https://www.twilio.com
2. Sign up for account
3. Verify email and phone number

### 3.2 Get Twilio Credentials

From Twilio Console Dashboard:
- **Account SID**: `ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`
- **Auth Token**: `xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

### 3.3 Setup WhatsApp Sandbox (Testing)

1. In Twilio: **Messaging → Try it out → Send a WhatsApp message**
2. You'll get:
   - Sandbox number: `+14155238886`
   - Join code: `join pleasant-verb`
3. On your phone: Send WhatsApp message `join pleasant-verb` to `+14155238886`
4. Format for config: `whatsapp:+14155238886`

---

## Step 4: Configure Credentials

### 4.1 Add Credentials to Host Variables

Edit your configuration:
```bash
nano local-setup/ansible/inventory/host_vars/bomet.yml
```

Add these lines (replace with YOUR actual values):
```yaml
# Novu Configuration
novu_api_key: "nv_2fH8Kj9Lm3Qr5Tx7Vz9Bc2Df4Gh6Jk"
novu_secret_key: "nv_secret_aB3dE5fG7hI9jK1lM3nO5pQ7rS9tU1vW3xY5zA7"

# Twilio Configuration  
twilio_account_sid: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
twilio_auth_token: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
twilio_whatsapp_from: "whatsapp:+14155238886"  # Sandbox number
```

---

## Step 5: Deploy and Bootstrap

### 5.1 Run Deploy with Credentials

```bash
cd local-setup/ansible
./deploy.sh bomet
```

This deployment will now:
1. Detect that credentials are present
2. Run `bootstrap-novu-whatsapp.sh` automatically
3. Create Twilio integration in Novu
4. Wire NOVU_API_KEY into Docker environment
5. Restart novu-bridge with credentials

### 5.2 Load TemplateBindings and Provider Configuration

After the services are running, you MUST load the configuration data using the setup script:

```bash
# Go to project root
cd /home/admin/Downloads/nitish-cloned-repos/cms/Citizen-Complaint-Resolution-System/

# First, update the script with your actual credentials
nano novu-setup.sh
```

Update these variables at the top of the file:
```bash
# Replace with YOUR actual values from previous steps
NOVU_API_KEY="nv_2fH8Kj9Lm3Qr5Tx7Vz9Bc2Df4Gh6Jk"  # From Novu Dashboard
TWILIO_ACCOUNT_SID="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"  # From Twilio Console
TWILIO_AUTH_TOKEN="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"  # From Twilio Console
TWILIO_WHATSAPP_FROM="whatsapp:+14155238886"  # Twilio Sandbox number
```

Run the script:
```bash
chmod +x novu-setup.sh
./novu-setup.sh
```

### 5.3 What the Setup Script Does

The `novu-setup.sh` script performs these critical steps:

1. **Verifies Novu API Key** - Checks if your key is valid
2. **Creates Config Schemas** - Sets up TemplateBinding, ProviderDetail, NotificationChannel schemas
3. **Loads Provider Configuration** - Configures Twilio WhatsApp with your credentials
4. **Creates Template Bindings** - Links these events to workflows:
   - COMPLAINTS.WORKFLOW.APPLY → complaints-workflow-apply
   - COMPLAINTS.WORKFLOW.ASSIGN → complaints-workflow-assign
   - COMPLAINTS.WORKFLOW.RESOLVE → complaints-workflow-resolve
   - COMPLAINTS.WORKFLOW.REJECT → complaints-workflow-reject
5. **Restarts Services** - Ensures config-service and novu-bridge pick up new configuration
6. **Verifies Setup** - Checks if everything loaded correctly

Expected output:
```
✓ Novu API Key is valid
✓ Schema TemplateBinding created
✓ Schema ProviderDetail created
✓ Schema NotificationChannel created
✓ Created ProviderDetail: Twilio.whatsapp.1
✓ Created NotificationChannel: NotificationChannel.WHATSAPP.be.bomet
✓ Created TemplateBinding: COMPLAINTS.WORKFLOW.APPLY.WHATSAPP.en_IN
✓ Created TemplateBinding: COMPLAINTS.WORKFLOW.ASSIGN.WHATSAPP.en_IN
✓ Created TemplateBinding: COMPLAINTS.WORKFLOW.RESOLVE.WHATSAPP.en_IN
✓ Created TemplateBinding: COMPLAINTS.WORKFLOW.REJECT.WHATSAPP.en_IN
✓ TemplateBinding configurations loaded
✓ ProviderDetail configuration loaded
✓ NOVU NOTIFICATION SETUP COMPLETE!
```

### 5.4 Important: Template Binding Structure

Each TemplateBinding created by the script contains:
```json
{
  "eventName": "COMPLAINTS.WORKFLOW.APPLY",  // Kafka event name
  "templateId": "complaints-workflow-apply",  // Must match workflow ID in workflows.js
  "channel": "WHATSAPP",
  "novuApiKey": "your-novu-api-key",
  "contentSid": "HXxxxxx",  // Twilio template ID (for approved templates)
  "requiredVars": ["complaintNo", "serviceName", "submittedDate"],
  "paramOrder": ["serviceName", "complaintNo", "submittedDate"]
}
```

**CRITICAL**: The `templateId` MUST match the workflow ID defined in `backend/novu-bridge-endpoint/workflows.js`

### 5.5 Verify Services Are Running

```bash
# Check all Novu services
docker ps | grep novu

# Should see:
# - novu-api
# - novu-worker  
# - novu-web
# - novu-ws
# - novu-bridge
# - novu-bridge-endpoint
```

---

## Step 6: Understanding Workflows

### 6.1 Where Workflows Are Defined

Workflows are defined in: `backend/novu-bridge-endpoint/workflows.js`

Current workflows:
```javascript
// OTP for login
'otp-send'                      // Login OTP codes

// Complaint lifecycle  
'complaints-workflow-apply'     // New complaint submitted
'complaints-workflow-assign'    // Assigned to staff
'complaints-workflow-resolve'   // Complaint resolved
'complaints-workflow-reject'    // Complaint rejected
'complaints-workflow-reopen'    // Complaint reopened
'complaints-workflow-reassign'  // Reassigned to different staff
'complaints-workflow-rate'      // Citizen rates service
```

### 6.2 How Workflows Sync to Novu

When `novu-bridge-endpoint` starts:

1. **Reads** `workflows.js` file
2. **Uses** NOVU_SECRET_KEY from environment
3. **Syncs** workflows to YOUR Novu account
4. **Creates/Updates** workflows in Novu

Verification:
```bash
# Check sync logs
docker logs novu-bridge-endpoint | grep -i "workflow"

# Should see:
# "Registering workflows with Novu..."
# "Successfully registered 9 workflows"
```

### 6.3 Workflow-to-Event Mapping

The workflow ID in `workflows.js` must match `templateId` in TemplateBinding:

| Kafka Event | Workflow ID | TemplateBinding templateId |
|------------|-------------|---------------------------|
| COMPLAINTS.WORKFLOW.APPLY | complaints-workflow-apply | complaints-workflow-apply |
| COMPLAINTS.WORKFLOW.ASSIGN | complaints-workflow-assign | complaints-workflow-assign |
| COMPLAINTS.WORKFLOW.RESOLVE | complaints-workflow-resolve | complaints-workflow-resolve |

---

## Step 7: Adding Custom Workflows

### 7.1 Edit Workflows File

```bash
nano backend/novu-bridge-endpoint/workflows.js
```

### 7.2 Add Your Custom Workflow

Add before `export const ALL_WORKFLOWS`:

```javascript
// Custom workflow for water bill reminders
export const waterBillReminder = workflow(
  'water-bill-reminder',  // This ID goes in TemplateBinding
  async ({ step, payload }) => {
    // SMS notification
    await step.sms('send-sms', async () => ({
      body: `Water bill reminder: ${payload.accountNumber}\nAmount: ${payload.amount}\nDue: ${payload.dueDate}\nPay at: ${payload.paymentLink}`,
    }));
    
    // WhatsApp notification (richer formatting)
    await step.chat('send-whatsapp', async () => ({
      body: `💧 *Water Bill Reminder*\n\nAccount: ${payload.accountNumber}\nAmount Due: *${payload.amount}*\nDue Date: ${payload.dueDate}\n\nPay now: ${payload.paymentLink}\n\nIgnore if already paid.`,
    }));
  },
  {
    name: 'Water Bill Reminder',
    payloadSchema: {
      type: 'object',
      properties: {
        accountNumber: { type: 'string' },
        amount: { type: 'string' },
        dueDate: { type: 'string' },
        paymentLink: { type: 'string' },
      },
      required: ['accountNumber', 'amount', 'dueDate'],
    },
  }
);

// Add to exports array
export const ALL_WORKFLOWS = [
  otpSendWorkflow,
  complaintsApply,
  complaintsAssign,
  complaintsResolve,
  complaintsReject,
  complaintsReopen,
  complaintsReassign,
  complaintsRate,
  complaintsSmsV1,
  waterBillReminder,  // ADD YOUR WORKFLOW HERE
];
```

### 7.3 Rebuild and Restart Service

```bash
# Rebuild the image with your changes
cd backend/novu-bridge-endpoint
docker build -t novu-bridge-endpoint:local .

# Update docker-compose to use local image
# Edit: local-setup/docker-compose.egov-digit.yaml
# Change: image: novu-bridge-endpoint:local

# Restart service
cd local-setup
docker-compose -f docker-compose.egov-digit.yaml restart novu-bridge-endpoint

# Check logs
docker logs novu-bridge-endpoint
```

### 7.4 Create TemplateBinding for Custom Workflow

```bash
curl -X POST http://localhost:18000/config-service/config/v1/_create/TemplateBinding \
  -H "Content-Type: application/json" \
  -d '{
    "RequestInfo": {"apiId": "setup"},
    "config": {
      "uniqueIdentifier": "WATER.BILL.REMINDER.WHATSAPP.en_IN",
      "eventName": "WATER.BILL.REMINDER",
      "templateId": "water-bill-reminder",  # Must match workflow ID
      "channel": "WHATSAPP",
      "tenantId": "be.bomet",
      "locale": "en_IN",
      "novuApiKey": "YOUR_NOVU_API_KEY",
      "requiredVars": ["accountNumber", "amount", "dueDate", "paymentLink"],
      "paramOrder": ["accountNumber", "amount", "dueDate", "paymentLink"]
    }
  }'
```

---

## Verification & Testing

### 1. Check Workflow Sync

```bash
# View synced workflows in logs
docker logs novu-bridge-endpoint | grep "workflow"

# Check Novu Dashboard
# Go to http://localhost/novu/ → Workflows
# You should see all your workflows listed
```

### 2. Test Notification Flow

```bash
# Test via novu-bridge dry-run endpoint
curl -X POST http://localhost:8085/novu/dispatch/_dry-run \
  -H "Content-Type: application/json" \
  -d '{
    "RequestInfo": {"apiId": "test"},
    "event": {
      "eventId": "test-001",
      "eventName": "COMPLAINTS.WORKFLOW.APPLY",
      "tenantId": "be.bomet",
      "module": "Complaints",
      "data": {
        "complaintNo": "PGR-TEST-001",
        "serviceName": "Streetlight",
        "submittedDate": "2024-01-15",
        "workflow": {
          "toState": "PENDINGFORASSIGNMENT"
        }
      },
      "actors": [{
        "userId": "test-user",
        "mobileNumber": "+254712345678",
        "name": "Test User"
      }]
    }
  }'
```

### 3. Check Activity Feed

In Novu Dashboard:
- Go to **Activity Feed**
- See all triggered notifications
- Check delivery status
- View any errors

---

## Troubleshooting

### Issue: "Workflows not syncing"

**Check logs:**
```bash
docker logs novu-bridge-endpoint
```

**Look for:**
- "NOVU_SECRET_KEY not found" → Add secret key to config
- "Failed to sync" → Check network/API URL
- "Successfully registered X workflows" → Working correctly

### Issue: "Workflow not found" when triggering

**Cause:** Workflow ID mismatch

**Solution:**
1. Check exact workflow ID in `workflows.js`
2. Ensure TemplateBinding has matching `templateId`
3. Restart novu-bridge-endpoint after changes

### Issue: "No notifications received"

**Check chain:**
1. Event published to Kafka? → Check Kafka topics
2. novu-bridge consumed event? → `docker logs novu-bridge`
3. Novu triggered? → Check Novu Activity Feed
4. WhatsApp sent? → Check Twilio logs

### Issue: "NOVU_SECRET_KEY not working"

**Verify:**
```bash
# Check environment variable is set
docker exec novu-bridge-endpoint env | grep NOVU

# Should see:
# NOVU_API_KEY=your_key
# NOVU_SECRET_KEY=your_secret
```

### Issue: Services not starting

**Check Docker Compose profiles:**
```bash
# Ensure notifications profile is active
cd local-setup
COMPOSE_PROFILES=egov,notifications docker-compose ps
```

---

## Important Notes

### Security
- **Never commit** API keys to Git
- Use different keys for dev/staging/production
- Rotate keys periodically
- Monitor usage in Novu/Twilio dashboards

### Workflow Management
- All workflows defined in `workflows.js` sync on service start
- Changes require service restart
- Workflow IDs must be unique across your account
- Test in development before production

### Multi-Tenant Considerations
- Each tenant (Bomet, Nairobi) should have separate Novu accounts
- Use different NOVU_SECRET_KEY per tenant
- Workflows are isolated per account

---

## Quick Reference Commands

```bash
# View all Novu services
docker ps | grep novu

# Check workflow sync
docker logs novu-bridge-endpoint | grep workflow

# Restart after workflow changes
docker-compose restart novu-bridge-endpoint

# Check novu-bridge processing
docker logs novu-bridge --tail 100

# Test dry-run
curl http://localhost:8085/novu/dispatch/_dry-run

# View Novu dashboard
open http://localhost/novu/

# Check environment variables
docker exec novu-bridge-endpoint env | grep NOVU
```

---

**Document Version:** 3.0  
**Last Updated:** January 2025  
**Architecture:** Complete 3-tier Novu integration  
**For:** DIGIT CCRS Bomet Implementation