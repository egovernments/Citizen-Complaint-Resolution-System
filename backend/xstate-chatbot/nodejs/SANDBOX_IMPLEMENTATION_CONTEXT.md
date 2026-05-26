# WhatsApp Chatbot Sandbox Mode Implementation Context

## Problem Statement
Implement multi-tenant WhatsApp chatbot for sandbox mode where:
- Each organization has its own tenant ID
- Webhook URL in Twilio/WhatsApp provider cannot be dynamically changed
- Need to support multiple organizations without hardcoding tenant IDs

## Current Issue
- Webhook URL has fixed tenantId parameter: `/xstate-chatbot/message?tenantId=pg`
- Cannot dynamically change this URL for different organizations
- Need to handle dynamic tenant selection based on user input

## Solution Approach

### Core Principle
**Remove tenantId from webhook URL entirely** and handle tenant resolution internally:
- **Non-sandbox mode**: Use `config.rootTenantId` (e.g., 'pg')
- **Sandbox mode**: Get tenant from user-provided organization code
- **No default tenant in sandbox**: Users must provide org code before any operations

### Implementation Flow

1. **Initial Message (Sandbox Mode)**
   - User sends "Hi" via WhatsApp
   - System creates temporary session (`temp_<mobileNumber>`)
   - NO user creation at this point
   - System asks for organization code

2. **Organization Code Validation**
   - User provides organization code
   - System validates against tenant-management service API
   - If valid, stores `organizationTenantId` in context

3. **User Registration Check**
   - Check if user exists in the organization's tenant
   - If exists: Create/login user with that tenant
   - If not exists: Show sandbox registration URL

4. **Subsequent Messages**
   - Use stored `organizationTenantId` for all API calls
   - All services (PGR, bills, etc.) use organization tenant

## Key Files Modified

### 1. `/src/session/session-manager.js`
- Modified `fromUser()` to delay user creation in sandbox mode
- Uses temporary user ID until org code is validated
- Creates real user only after organization validation

### 2. `/src/machine/seva.js`
- Added organization code validation flow after language selection
- Added `triggerUserLogin` state to handle user creation after validation
- Modified `notRegistered` state to show sandbox registration URL

### 3. `/src/env-variables.js`
```javascript
enableSandboxMode: process.env.ENABLE_SANDBOX_MODE === 'true',
tenantManagementHost: process.env.TENANT_MANAGEMENT_HOST || 'http://localhost:8081/tenant-management',
sandboxHost: process.env.SANDBOX_HOST || 'https://sandbox.digit.org'
```

### 4. `/src/machine/service/organization-service.js`
- Created service to handle organization validation
- Methods: `validateOrganizationCode()`, `checkAndAuthenticateUser()`, `getSandboxRegistrationUrl()`

### 5. `/src/machine/pgr.js`
- Modified to skip city/locality selection in sandbox mode
- Uses organization code as tenant for all operations

## Critical Design Decisions

1. **No Default Tenant in Sandbox**
   - Don't use any fallback tenant
   - Force org code collection before any operations

2. **Temporary Sessions**
   - Use `temp_<mobileNumber>` as user ID before validation
   - Store minimal state until org code is provided

3. **Delayed User Creation**
   - User creation/login happens ONLY after org code validation
   - User is created directly in the correct tenant

## Error Scenarios Handled

1. **Invalid Organization Code**
   - Show error message and ask again

2. **User Not Registered**
   - Show sandbox registration URL
   - Format: `https://sandbox.digit.org/<orgCode>/employee/user/signup`

3. **Tenant Service Unavailable**
   - Graceful error handling with user-friendly messages

4. **User Creation Failure**
   - Proper error messages with retry guidance



## Environment Variables Required

```bash
ENABLE_SANDBOX_MODE=true
TENANT_MANAGEMENT_HOST=http://localhost:8081/tenant-management
SANDBOX_HOST=https://sandbox.digit.org
ROOT_TENANTID=pg  # Only for non-sandbox mode
```

## Testing Approach

1. Remove `?tenantId=pg` from webhook URL in Twilio
2. Port-forward tenant-management service: `kubectl port-forward svc/tenant-management 8081:8080 -n egov`
3. Test flow:
   - Send "Hi" → Should ask for org code
   - Enter valid org code → Should check registration
   - If not registered → Should show registration URL
   - If registered → Should proceed with normal flow

## Pending Tasks

1. Test complete flow with port-forwarded tenant-management service
2. Verify session persistence across flow restart
3. Test error scenarios (invalid org code, service down)
4. Commit and push changes to sandbox-changes branch

## Key Insight
The solution avoids URL tenant dependency by:
- Using temporary sessions before org code
- Storing organization tenant in session context
- Creating users directly in the correct tenant
- Never using a default/sandbox tenant ID