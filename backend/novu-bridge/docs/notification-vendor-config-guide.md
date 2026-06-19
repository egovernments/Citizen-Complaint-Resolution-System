# Configuring a New WhatsApp or SMS Notification Vendor

## Purpose

This document guides a programme/operations team through the steps to onboard a new notification vendor (WhatsApp or SMS) for any city/tenant in the DIGIT system. No technical background is required.

---

## What You Will Need Before Starting

Collect the following from your vendor before raising a configuration request with the technical team.

### For WhatsApp

| What | Description | Who Provides It |
|---|---|---|
| Account ID | Your unique account identifier on the vendor platform | Vendor dashboard |
| Auth Token / Secret Key | Password/key to authenticate API calls | Vendor dashboard |
| Sender WhatsApp Number | The registered business WhatsApp number that messages will be sent from | Vendor dashboard |
| Approved Template Names | The exact names of message templates approved by WhatsApp/vendor for each notification type | Vendor dashboard or WhatsApp Business Manager |
| Template Body | The full text of each template, showing which parts are variable (e.g. complaint number, status) | Vendor / WhatsApp Business Manager |

### For SMS

| What | Description | Who Provides It |
|---|---|---|
| Account ID / Auth ID | Your account identifier on the vendor platform | Vendor dashboard |
| Auth Token / API Key | Password/key to authenticate API calls | Vendor dashboard |
| Sender ID | The name or number that appears as the SMS sender (e.g. DIGIT, AMRCTY) | Vendor dashboard (subject to DLT registration in India) |
| DLT Template IDs | Registered template IDs from the TRAI DLT portal (mandatory for India) | DLT portal |

---

## Step-by-Step Configuration

### Step 1 — Decide Which Notifications to Enable

Identify which complaint lifecycle events should trigger a notification. The system supports these events:

| Event | When It Fires |
|---|---|
| Complaint Filed | Citizen submits a new complaint |
| Complaint Assigned | Complaint is assigned to a field employee |
| Complaint Reassigned | Complaint is transferred to a different employee |
| Complaint Resolved | Employee marks the complaint as resolved |
| Complaint Rejected | Complaint is rejected with a reason |
| Complaint Reopened | Citizen or supervisor reopens a resolved complaint |
| Complaint Rated | Citizen submits a satisfaction rating |

Decide for each event: **Should a notification be sent? Via WhatsApp, SMS, or both?** Document this as your notification matrix before proceeding.

---

### Step 2 — Register the Vendor Credentials

Raise a configuration request with your technical/operations team to create a **Provider record** for each city you want to activate.

Provide the following for each city:

| Field | What to Fill |
|---|---|
| City (Tenant ID) | e.g. pb.amritsar |
| Vendor Name | e.g. karix, twilio, plivo, valuefirst |
| Channel | whatsapp or sms |
| Account ID | From the vendor dashboard |
| Auth Token | From the vendor dashboard |
| Sender Number / Sender ID | From the vendor dashboard |
| Active | Yes |
| Priority | 1 (use 2 or higher for fallback providers) |

**One record per city per channel.** If a city uses both WhatsApp and SMS, two separate records are needed.

**Multiple vendors for the same channel:** Set Priority = 1 for the primary vendor and Priority = 2 for the backup. The system automatically uses the highest-priority active vendor.

---

### Step 3 — Map Notifications to Templates

For each event selected in Step 1, raise a configuration request to create a **Template Binding record**.

Provide the following for each mapping:

| Field | What to Fill |
|---|---|
| City (Tenant ID) | e.g. pb.amritsar |
| Event Name | From the event list in Step 1 |
| Channel | whatsapp or sms |
| Language | e.g. en_IN (English), hi_IN (Hindi), pa_IN (Punjabi) |
| Workflow ID | The internal workflow name — your technical team will confirm this |
| Template Name | Exact name of the approved template on the vendor platform |
| Template Variables (in order) | The complaint data fields that fill in the template placeholders, in the order they appear |
| Required Variables | Which of the above fields must be present for the message to send |

**One record per city × event × language.** If you want Hindi and English notifications for the same event, create two records with the same event but different language codes.

**Example mapping for "Complaint Filed" event, WhatsApp, English:**

| Field | Value |
|---|---|
| City | pb.amritsar |
| Event | COMPLAINTS.WORKFLOW.APPLY |
| Channel | whatsapp |
| Language | en_IN |
| Template Name | complaint_apply |
| Template Variables (in order) | complaintNo, serviceName |
| Required Variables | complaintNo, serviceName |

If your WhatsApp template body is:

*"Your complaint {{1}} for {{2}} has been filed. Track status on DIGIT."*

Then Variable 1 = complaintNo, Variable 2 = serviceName.

---

### Step 4 — Verify Configuration (Dry Run)

Before going live, ask your technical team to run a **dry-run test** for each city and event combination you have configured.

The dry run checks:

- Vendor credentials are correctly stored
- Template mapping resolves to the right template
- All required template variables are available in the complaint data

The dry run does **not** send any actual messages.

**What to check in the dry-run result:**

| Result Field | Expected Value | If Not As Expected |
|---|---|---|
| Valid | Yes | Review template variable names |
| Preference Allowed | Yes | Citizen notification preference may be off |
| Resolved Provider | Your vendor name | Check Step 2 configuration |
| Resolved Template | Your template name | Check Step 3 configuration |
| Missing Required Variables | Empty (none missing) | Fix variable names in Template Binding |

---

### Step 5 — Send a Test Message

Once the dry run passes, ask the technical team to send a live test message to a known phone number.

Confirm:

- Message was received on the test phone
- Sender name/number is correct
- Template text is correct and variables are filled in properly
- Language is correct

If the message is not received, refer to the Troubleshooting section.

---

### Step 6 — Go Live

After the test message is confirmed:

1. Confirm the provider record is set to **Active = Yes**.
2. File a test complaint on the DIGIT portal.
3. Trace all configured events through to message delivery.
4. Sign off go-live confirmation with the technical team.

---

## Managing Multiple Vendors

### Switching from One Vendor to Another

1. Set the current vendor's **Active = No** in its Provider record.
2. Create a new Provider record for the new vendor with Priority = 1, Active = Yes.
3. Run a dry-run and test message for the new vendor.
4. Only after a successful test, deactivate the old vendor permanently.

**Never deactivate the old vendor before confirming the new one works.** Keep the old record with Active = No for rollback.

### Fallback / Backup Vendor

To configure a backup vendor that activates if the primary fails:

1. Add the backup provider with Priority = 2, Active = Yes.
2. The system will automatically try the backup if the primary is unavailable.

---

## Template Guidelines

### WhatsApp Template Requirements

- Templates must be **pre-approved by Meta (WhatsApp)** before they can be used.
- Approval can take 24–72 hours; plan ahead.
- Template names must use only lowercase letters, numbers, and underscores (e.g. complaint_apply). No spaces or hyphens.
- Variable placeholders in the template body must appear in the same order as your variable configuration.
- Any change to template text requires re-approval from Meta/WhatsApp.

### SMS Template Requirements (India)

- All commercial SMS templates must be registered on the **DLT (Distributed Ledger Technology) portal** under TRAI regulations.
- Sender IDs (6-character header) also require DLT registration.
- Variable fields in DLT-registered templates must match what is configured in the system.
- Any change to template text requires fresh DLT registration.

---

## Troubleshooting

| Problem | Likely Cause | Action |
|---|---|---|
| No message received after live test | Wrong phone number in test, or vendor credentials wrong | Verify credentials in Provider record; check vendor account balance |
| Wrong sender name/number appearing | Sender ID not configured or not approved | Check Sender Number/ID in Provider record; verify with vendor |
| Template variables appear blank | Variable name mismatch between Template Binding and complaint data | Cross-check variable names; ask technical team to run dry-run |
| Message sent in wrong language | Wrong locale in Template Binding | Add a separate Template Binding record for the correct locale |
| Messages stopped sending | Vendor account balance exhausted, or auth token expired | Recharge account; regenerate and update auth token |
| Dry run shows "Preference Denied" | Citizen has opted out of notifications | This is by design; no action needed |
| Dry run shows "No Active Provider" | Provider record missing or Active = No | Check and correct Provider record for that city and channel |

---

## Who Does What

| Activity | Programme Team | Technical Team |
|---|---|---|
| Collect vendor credentials | Responsible | — |
| Get WhatsApp templates approved | Responsible | — |
| DLT registration for SMS (India) | Responsible | — |
| Create Provider record in system | Raises request | Executes |
| Create Template Binding records | Raises request with data | Executes |
| Dry-run validation | Reviews results | Executes |
| Live test message | Confirms receipt | Sends |
| Go-live sign-off | Responsible | — |

---

## Notification Matrix Template

Use this table to plan your configuration before raising requests.

| Event | WhatsApp | SMS | Language(s) | Template Name | Variables Needed |
|---|---|---|---|---|---|
| Complaint Filed | | | | | |
| Complaint Assigned | | | | | |
| Complaint Reassigned | | | | | |
| Complaint Resolved | | | | | |
| Complaint Rejected | | | | | |
| Complaint Reopened | | | | | |
| Complaint Rated | | | | | |

*Fill Yes/No in the WhatsApp and SMS columns, then complete the remaining fields for each Yes entry.*

---

*Document version 1.0 — DIGIT Notification Infrastructure*
