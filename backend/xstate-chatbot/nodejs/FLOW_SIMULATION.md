# WhatsApp Chatbot Flow Simulation

## 🎯 Summary of Changes

### Environment Variables
- **Default sandbox mode**: `ENABLE_SANDBOX_MODE` now defaults to `true`
- **Tenant management host**: Changed from `localhost:8081` to `https://sandbox-demo.digit.org/tenant-management`
- **Removed**: `sandboxTenantId` (no longer needed)

### Code Changes
1. **session-manager.js**: Simplified to handle org code collection without temporary sessions
2. **seva.js**: Removed complex `triggerUserLogin` state, replaced with simple `userFound` state
3. **pgr.js**: Already has proper sandbox checks (no changes needed)

---

## 📱 SANDBOX MODE (ENABLE_SANDBOX_MODE=true)

### Flow 1: New User Registration Check

```
User: Hi
Bot: Welcome to the Sandbox WhatsApp Service! 🏛️
     Please enter your organization code to continue.
     
User: pg
Bot: [Validates against tenant-management API]
     [Checks if user exists in 'pg' tenant]
     
If user exists:
Bot: Organization verified successfully!
     Welcome! I can help you with:
     1. File a complaint
     2. Track complaints
     
If user doesn't exist:
Bot: You are not registered with organization 'Punjab'.
     Please register at:
     https://sandbox.digit.org/digit-ui/citizen/login?orgCode=pg
     
     Once registered, type 'Hi' to start again.
```

### Flow 2: Existing User - File Complaint

```
User: Hi
Bot: Welcome to the Sandbox WhatsApp Service! 🏛️
     Please enter your organization code to continue.
     
User: pg
Bot: Organization verified successfully!
     Welcome! Please select your language:
     1. English
     2. हिंदी
     
User: 1
Bot: Welcome! What's your name?

User: John Doe
Bot: Thank you John Doe!
     How can I help you today?
     1. File a complaint
     2. Track complaints
     
User: 1
Bot: Please select the complaint type:
     1. Streetlight not working
     2. Water supply issue
     3. Garbage not collected
     
User: 3
Bot: [SKIPS CITY SELECTION - Uses 'pg' as city]
     [SKIPS LOCALITY SELECTION - Uses 'pg' as locality]
     Please share location of the complaint
     1. Send current location
     2. Type location
     
User: 2
Bot: Please type the location:

User: Near Park Street
Bot: Please provide additional details about the complaint:

User: Garbage has not been collected for 3 days
Bot: Would you like to attach a photo?
     1. Yes
     2. No
     
User: 2
Bot: Complaint created successfully!
     Complaint ID: PGR-2024-001234
     You'll receive updates on your registered mobile number.
```

### Flow 3: Invalid Organization Code

```
User: Hi
Bot: Welcome to the Sandbox WhatsApp Service! 🏛️
     Please enter your organization code to continue.
     
User: xyz123
Bot: Invalid organization code 'xyz123'.
     Please enter a valid organization code or type 'Hi' to restart.
     
User: Hi
Bot: Welcome to the Sandbox WhatsApp Service! 🏛️
     Please enter your organization code to continue.
```

---

## 🏢 NON-SANDBOX MODE (ENABLE_SANDBOX_MODE=false)

### Flow: File Complaint with City/Locality Selection

```
User: Hi
Bot: [SKIPS ORG CODE - Uses ROOT_TENANTID from env]
     Welcome! Please select your language:
     1. English
     2. हिंदी
     
User: 1
Bot: Welcome! What's your name?

User: Jane Smith
Bot: Thank you Jane Smith!
     How can I help you today?
     1. File a complaint
     2. Track complaints
     
User: 1
Bot: Please select the complaint type:
     1. Streetlight not working
     2. Water supply issue
     3. Garbage not collected
     
User: 2
Bot: [WITH CITY SELECTION]
     Please select your city:
     1. Amritsar
     2. Jalandhar  
     3. Ludhiana
     4. Patiala
     
User: 3
Bot: [WITH LOCALITY SELECTION]
     Please select your locality in Ludhiana:
     1. Model Town
     2. Civil Lines
     3. Sarabha Nagar
     4. BRS Nagar
     
User: 1
Bot: Please share location of the complaint
     1. Send current location
     2. Type location
     
User: 1
Bot: [User shares GPS location]
     Location received!
     Please provide additional details:

User: No water supply since morning
Bot: Would you like to attach a photo?
     1. Yes
     2. No
     
User: 1
Bot: Please share the photo
User: [Sends photo]
Bot: Photo received!
     Complaint created successfully!
     Complaint ID: PGR-2024-005678
     You'll receive updates on your registered mobile number.
```

---

## 🔄 Session Management Differences

### Sandbox Mode
1. **Every "Hi" is fresh**: Previous session cleared, org code requested
2. **Session starts after org validation**: Only after valid org code
3. **Tenant from user input**: Uses organization code as tenant ID
4. **No city/locality selection**: Automatically uses org code

### Non-Sandbox Mode  
1. **"Hi" continues session**: Or creates new one with ROOT_TENANTID
2. **Session starts immediately**: With configured root tenant
3. **Tenant from config**: Uses ROOT_TENANTID environment variable
4. **Full city/locality selection**: Based on MDMS data for the tenant

---

## ✅ Key Validations

### What Works in Both Modes:
- ✅ User authentication and creation
- ✅ Language selection
- ✅ Name collection
- ✅ Complaint type selection
- ✅ Location sharing (GPS/Text)
- ✅ Photo attachments
- ✅ Complaint tracking
- ✅ Bill payments
- ✅ Receipt viewing

### Sandbox-Specific Features:
- ✅ Organization code validation via tenant-management API
- ✅ Registration URL generation for unregistered users
- ✅ Multi-tenant support without URL changes
- ✅ Session isolation per organization

### Non-Sandbox Features Preserved:
- ✅ City selection from MDMS
- ✅ Locality selection based on city
- ✅ Geo-search if enabled
- ✅ All existing PGR workflows

---

## 🚀 Testing Commands

### Test Sandbox Mode:
```bash
export ENABLE_SANDBOX_MODE=true
export TENANT_MANAGEMENT_HOST=https://sandbox-demo.digit.org/tenant-management
npm start
```

### Test Non-Sandbox Mode:
```bash
export ENABLE_SANDBOX_MODE=false
export ROOT_TENANTID=pg
npm start
```

### Test with Console Provider:
```bash
export WHATSAPP_PROVIDER=Console
node src/app.js
```

Then test by sending messages in the console.