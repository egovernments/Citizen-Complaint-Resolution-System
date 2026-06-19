# Design: Organization Code-Based Tenant Resolution & Related Changes

## Overview

This document covers three design changes to the xstate-chatbot:

1. **Org code capture on first contact** — ask citizen for org code, resolve tenantId from it, validate user.
2. **Sandbox bypass** — skip tenant selection in sandbox; show login message if user not found.
3. **Location sharing image bypass** — replace filestore image with text instructions.

---

## 1. Current Login Flow (Baseline)

```
WhatsApp "Hi" arrives
        ↓
channel/value-first.js
  - Sets extraInfo.tenantId = config.rootTenantId  ← always 'pg', from config
        ↓
session-manager.js → fromUser()
  - Calls userService.getUserForMobileNumber(mobileNumber, tenantId)
      ↓ loginOrCreateUser()
        ↓ loginUser() → POST /user/oauth/token (password grant, hardcoded pw)
        ↓ If 404 → createUser() → wait 1s → loginUser() again
  - Sets reformattedMessage.user = { authToken, userId, name, locale, ... }
        ↓
XState machine starts (seva.js)
  - start → onboarding (if no locale) or welcome
  - Onboarding: asks language → asks name → updates profile → welcome
  - welcome → pgr menu (file / track complaint)
```

**Problem**: `tenantId` is always the root tenant from config. No org code capture. User is auto-created in root tenant regardless of which organization they belong to.

---

## 2. Proposed New Flow

```
WhatsApp "Hi" arrives
        ↓
channel/value-first.js
  - extraInfo.tenantId = null  ← NOT set from config anymore
        ↓
session-manager.js → fromUser()
  - Skips getUserForMobileNumber() if tenantId is null (first contact)
  - Creates anonymous pre-session with only mobileNumber in context
        ↓
XState machine (seva.js)
  - NEW state: orgCodeEntry → asks citizen for organization code
        ↓
  - user-service.resolveOrgCode(orgCode)
      → returns tenantId mapped to orgCode
        ↓
  - user-service.validateUser(mobileNumber, tenantId)
      → calls loginUser() only (no auto-create)
        ↓
  [If user found]               [If user NOT found]
        ↓                              ↓
  Set tenantId in context     [SANDBOX_MODE=true?]
  Proceed to locale/welcome          ↓ Yes          ↓ No
                              Show sandbox       Show "register
                              login message      new org" option
        ↓
  PGR menu — tenantId already set, SKIP city/tenant selection prompt
```

---

## 3. Detailed State Changes

### 3.1 `seva.js` — New `orgCodeEntry` State

**Insert before `onboardingLocale`** as the first state in `onboarding`.

```
onboarding
  └── orgCodeEntry          ← NEW (first step)
        ├── question        → sends "Please enter your organization code"
        ├── process         → calls resolveAndValidateUser(orgCode, mobileNumber)
        ├── found           → sets context.extraInfo.tenantId, proceed to onboardingLocale
        ├── notFound        → routes to sandboxMessage or registerOrg based on env
        └── registerOrg     → shows "To register a new org, visit <link> or contact admin"
```

**Context additions:**
- `context.extraInfo.tenantId` — set after successful org code resolution
- `context.extraInfo.orgCode` — stored for reference
- `context.user.authToken` etc. — populated after successful login

**New messages to add in `seva.js`:**

```javascript
orgCodeEntry: {
  question: {
    en_IN: "Welcome! Please type and send your *Organization Code* to continue.",
    hi_IN: "स्वागत है! कृपया जारी रखने के लिए अपना *संगठन कोड* टाइप करें और भेजें।"
  },
  notFound: {
    sandbox: {
      en_IN: "No account found for this mobile number in the given organization.\n\nPlease login at *sandbox.digit.org* to register first, then return here.",
      hi_IN: "दिए गए संगठन में इस मोबाइल नंबर के लिए कोई खाता नहीं मिला।\n\nकृपया पहले *sandbox.digit.org* पर लॉगिन करें और फिर यहाँ वापस आएं।"
    },
    production: {
      en_IN: "No account found for this mobile number.\n\nWould you like to register a new organization?\n\n*1.* Yes, register\n*2.* No, go back",
      hi_IN: "इस मोबाइल नंबर के लिए कोई खाता नहीं मिला।\n\nक्या आप एक नया संगठन पंजीकृत करना चाहेंगे?\n\n*1.* हाँ, पंजीकृत करें\n*2.* नहीं, वापस जाएं"
    }
  },
  invalidCode: {
    en_IN: "Invalid organization code. Please check and try again.",
    hi_IN: "अमान्य संगठन कोड। कृपया जांचें और पुनः प्रयास करें।"
  },
  registerOrg: {
    en_IN: "To register a new organization, please contact your administrator or visit the DIGIT portal.",
    hi_IN: "नया संगठन पंजीकृत करने के लिए, कृपया अपने प्रशासक से संपर्क करें या DIGIT पोर्टल पर जाएं।"
  }
}
```

---

### 3.2 `session-manager.js` — Decouple Login from First Contact

**Current** (`session-manager.js:13–31`):
```javascript
async fromUser(reformattedMessage) {
  let user = await userService.getUserForMobileNumber(
    mobileNumber, reformattedMessage.extraInfo.tenantId   // always called
  );
  ...
}
```

**Change**: Only call `getUserForMobileNumber` if `tenantId` is already resolved (i.e., not the first contact).

```javascript
async fromUser(reformattedMessage) {
  let mobileNumber = reformattedMessage.user.mobileNumber;
  let tenantId = reformattedMessage.extraInfo.tenantId;

  if (tenantId) {
    // Existing session or tenantId already resolved — authenticate as before
    try {
      user = await userService.getUserForMobileNumber(mobileNumber, tenantId);
      reformattedMessage.user = user;
    } catch (error) { ... }
  } else {
    // First contact — no tenantId yet, set minimal user for machine to start
    reformattedMessage.user = { mobileNumber };
  }
  ...
}
```

**Note**: After the machine captures org code and resolves tenantId, it must trigger authentication. This is done via a new XState invoked service in the `orgCodeEntry.process` state that calls `userService.validateAndLoginUser(orgCode, mobileNumber)`.

---

### 3.3 `user-service.js` — New Methods

**Add two new methods:**

#### `resolveOrgCode(orgCode)`
Resolves an org code to a tenantId. Two options:
- **Option A (recommended for MVP)**: Static map from env variable `ORG_CODE_TENANT_MAP`
  ```
  ORG_CODE_TENANT_MAP=AMRSTR:pg.amritsar,LDHNA:pg.ludhiana,MOHALI:pg.mohali
  ```
- **Option B**: MDMS lookup via `egov-mdms-service` for org master data.

```javascript
resolveOrgCode(orgCode) {
  const map = this.buildOrgTenantMap();   // parsed from env var
  const tenantId = map[orgCode.toUpperCase()];
  return tenantId || null;   // null = invalid org code
}
```

#### `validateUser(mobileNumber, tenantId)`
Calls `loginUser()` only — does NOT auto-create the user.

```javascript
async validateUser(mobileNumber, tenantId) {
  const user = await this.loginUser(mobileNumber, tenantId);
  if (!user) return null;
  return await this.enrichuserDetails(user);
}
```

#### New combined method for the machine's invoked service:

```javascript
async resolveOrgAndValidateUser(orgCode, mobileNumber) {
  const tenantId = this.resolveOrgCode(orgCode);
  if (!tenantId) return { status: 'INVALID_ORG', tenantId: null, user: null };

  const user = await this.validateUser(mobileNumber, tenantId);
  if (!user) return { status: 'USER_NOT_FOUND', tenantId, user: null };

  return { status: 'OK', tenantId, user };
}
```

---

### 3.4 `env-variables.js` — New Variables

```javascript
sandboxMode: process.env.SANDBOX_MODE === 'true',

orgCodeTenantMap: process.env.ORG_CODE_TENANT_MAP || '',
// Format: "ORGCODE1:tenant1,ORGCODE2:tenant2"
// Example: "AMRSTR:pg.amritsar,LDHNA:pg.ludhiana"
```

---

### 3.5 Channel Providers — Stop Setting `tenantId` from Config

**Files**: `value-first.js`, `kaleyra.js`, `twilio.js`, `console.js`

**Change**: Remove `tenantId: config.rootTenantId` from the `extraInfo` object.

| File | Line(s) | Change |
|------|---------|--------|
| `value-first.js` | 45, 188 | Remove `tenantId: config.rootTenantId` |
| `twilio.js` | 244 | Remove `tenantId: config.rootTenantId` |
| `console.js` | 17 | Remove `tenantId: config.rootTenantId` |
| `kaleyra.js` | — | Already missing; add `tenantId: null` explicitly |

**Filestore calls** inside channel providers that use `config.rootTenantId` directly (not via `extraInfo`) should remain as-is for now — those are upload endpoints that don't need per-tenant routing at the channel layer.

---

### 3.6 `pgr.js` — Bypass Tenant/City Selection if Already Resolved

**Current**: `city` state always shows a list of cities for the citizen to pick (`pgr.js:659–708`).

**Change**: In the `location` state, before entering `city`, check if `context.extraInfo.tenantId` already has a resolved sub-tenant (city-level). If so, skip `city` selection entirely.

```javascript
// In fileComplaint.location.geoLocation.process onDone:
{
  target: '#city',
  cond: (context, event) => !event.data && !config.pgrUseCase.geoSearch
    && !context.extraInfo.tenantId.includes('.')  // ← only if not already city-level
},
{
  target: '#persistComplaint',       // skip city — tenantId IS the city
  cond: (context, event) => !event.data
    && context.extraInfo.tenantId.includes('.')   // e.g. "pg.amritsar"
    && context.message === '1',
  actions: assign((context) => {
    context.slots.pgr.city = context.extraInfo.tenantId;
  })
}
```

---

## 4. Image Bypass — Location Sharing Instructions

### Current Behavior (`pgr.js:258–269`)

```javascript
geoLocationSharingInfo: {
  onEntry: assign((context, event) => {
    var message = {
      type: 'image',
      output: config.pgrUseCase.informationImageFilestoreId  // fetches image from filestore
    };
    dialog.sendMessage(context, message);
  }),
  always: 'geoLocation'
}
```

This sends a filestore image to show citizens how to share location.

### Problem

- Requires a valid `informationImageFilestoreId` in filestore.
- Filestore call fails in dev/sandbox environments where file doesn't exist.
- Introduces unnecessary async delay before the location question.

### Change — Replace Image with Text Instructions

```javascript
geoLocationSharingInfo: {
  onEntry: assign((context, event) => {
    const message = dialog.get_message(
      messages.fileComplaint.locationSharingInfo,
      context.user.locale
    );
    dialog.sendMessage(context, message);
  }),
  always: 'geoLocation'
}
```

**New message to add in `pgr.js`:**

```javascript
locationSharingInfo: {
  en_IN: "📍 *How to share your location on WhatsApp:*\n\n1️⃣ Tap the *attachment* icon ( 📎 ) in the chat.\n2️⃣ Select *Location*.\n3️⃣ Choose *Send Your Current Location*.\n\nOr tap *1* to skip and enter city manually.",
  hi_IN: "📍 *WhatsApp पर अपना स्थान कैसे साझा करें:*\n\n1️⃣ चैट में *अटैचमेंट* आइकन ( 📎 ) पर टैप करें।\n2️⃣ *स्थान* चुनें।\n3️⃣ *अपना वर्तमान स्थान भेजें* चुनें।\n\nया मैन्युअल रूप से शहर दर्ज करने के लिए *1* टाइप करें।",
  pa_IN: "📍 *WhatsApp 'ਤੇ ਆਪਣਾ ਟਿਕਾਣਾ ਕਿਵੇਂ ਸਾਂਝਾ ਕਰਨਾ ਹੈ:*\n\n1️⃣ ਚੈਟ ਵਿੱਚ *ਅਟੈਚਮੈਂਟ* ਆਈਕਨ ( 📎 ) 'ਤੇ ਟੈਪ ਕਰੋ।\n2️⃣ *ਟਿਕਾਣਾ* ਚੁਣੋ।\n3️⃣ *ਆਪਣਾ ਮੌਜੂਦਾ ਟਿਕਾਣਾ ਭੇਜੋ* ਚੁਣੋ।\n\nਜਾਂ ਦਸਤੀ ਸ਼ਹਿਰ ਦਰਜ ਕਰਨ ਲਈ *1* ਟਾਈਪ ਕਰੋ।"
}
```

**Also remove** the env variable dependency:
```javascript
// env-variables.js — this can be deprecated
informationImageFilestoreId: process.env.INFORMATION_IMAGE_FILESTORE_ID || '...'
```

---

## 5. Full Impact Matrix

| File | Change | Reason |
|------|--------|--------|
| `src/channel/value-first.js` | Remove `tenantId: config.rootTenantId` from lines 45, 188 | tenantId now resolved from org code |
| `src/channel/kaleyra.js` | Add `tenantId: null` to `extraInfo` | Consistency |
| `src/channel/twilio.js` | Remove `tenantId: config.rootTenantId` from line 244 | tenantId now resolved from org code |
| `src/channel/console.js` | Remove `tenantId: config.rootTenantId` from line 17 | tenantId now resolved from org code |
| `src/session/session-manager.js` | Conditionally skip `getUserForMobileNumber` when `tenantId` is null | First contact has no tenantId yet |
| `src/session/user-service.js` | Add `resolveOrgCode()`, `validateUser()`, `resolveOrgAndValidateUser()` | Org code → tenant resolution |
| `src/machine/seva.js` | Add `orgCodeEntry` state before `onboardingLocale`; add sandbox/notFound routing | New first-contact flow |
| `src/machine/pgr.js` | Replace image send in `geoLocationSharingInfo` with text; bypass `city` state if tenantId is city-level | Location UX + org-resolved tenant |
| `src/machine/service/egov-pgr.js` | `fetchOpenComplaints` uses `config.rootTenantId` (line 532) — change to `context.extraInfo.tenantId` | Dynamic tenant support |
| `src/machine/util/localisation-service.js` | Line 14 uses `config.rootTenantId` — consider passing tenantId from context | Dynamic locale fetch |
| `src/env-variables.js` | Add `SANDBOX_MODE`, `ORG_CODE_TENANT_MAP` | New config |

---

## 6. New XState State Diagram (`seva.js` onboarding)

```
start
  └── USER_MESSAGE
        ├── [has locale] → #welcome
        └── [no locale]  → #onboarding

onboarding
  └── orgCodeEntry                    ← NEW
        ├── question  → USER_MESSAGE → process
        └── process   → invoke: resolveOrgAndValidateUser(orgCode, mobileNumber)
              ├── status=OK           → set tenantId/user in context → #onboardingLocale
              ├── status=USER_NOT_FOUND + SANDBOX_MODE=true
              │                       → #sandboxLoginMessage → endstate
              ├── status=USER_NOT_FOUND + SANDBOX_MODE=false
              │                       → #registerOrgOption
              │       ├── [1] Yes     → show registration instructions → endstate
              │       └── [2] No      → #orgCodeEntry (restart)
              └── status=INVALID_ORG  → error → #orgCodeEntry (retry)

  → onboardingLocale (existing)
  → onboardingWelcome (existing)
  → onboardingName (existing)
  → ...
```

---

## 7. Sandbox vs Production Behavior

| Scenario | Sandbox (`SANDBOX_MODE=true`) | Production |
|----------|-------------------------------|------------|
| Valid org code, user exists | Proceed normally | Proceed normally |
| Valid org code, user NOT found | Show: "Login at sandbox URL first" | Show: "Register new org" option |
| Invalid org code | Ask to retry (both) | Ask to retry (both) |
| Tenant selection (city) | **Bypassed** if tenantId resolved to city-level | **Bypassed** if tenantId resolved to city-level |

---

## 8. Env Variable Reference

```bash
# Existing
ROOT_TENANTID=pg                          # kept for fallback only
USER_SERVICE_HARDCODED_PASSWORD=123456    # unchanged

# New
SANDBOX_MODE=true                         # true = sandbox, false/unset = production
ORG_CODE_TENANT_MAP=AMRSTR:pg.amritsar,LDHNA:pg.ludhiana,MOHALI:pg.mohali
                                          # maps org code → tenantId

# Deprecated (image bypass)
# INFORMATION_IMAGE_FILESTORE_ID          # no longer needed after text instruction change
```

---

## 9. Files NOT Changed

- `src/machine/service/pgr-status-update-events.js` — uses tenantId from Kafka event payload (`serviceWrapper.service.tenantId`), not from channel. No change needed.
- `src/machine/service/egov-user-profile.js` — already receives tenantId as parameter from `seva.js:285`. No change needed.
- `src/session/repo/` — session storage is keyed by userId, not tenantId. No change needed.
