# Provider-Agnostic Notification System Setup

## Overview
The notification system has been refactored to support multiple providers without hardcoding provider-specific logic. It uses direct credential pass-through to Novu, allowing dynamic provider configuration per tenant.

## Key Changes Made

### 1. Generic Provider Model
- Updated `ResolvedProvider` to include generic `credentials` map
- Credentials are stored in Novu-compatible format
- Removed hardcoded provider-specific fields

### 2. Direct Credential Pass-through
- Implemented `triggerWithProviderCredentials()` in `NovuClient`
- Passes provider credentials directly to Novu without integration manager
- Eliminated provider-specific switch statements

### 3. Dynamic Configuration Resolution
- `ConfigServiceClient.resolveProvider()` retrieves generic provider config
- Supports multi-tenant provider configurations
- Uses "whatsapp-provider" as lookup key instead of hardcoded "twilio"

## Schema Configuration

### ProviderDetail Schema
Defines provider configurations per tenant:

```json
{
  "tenantId": "pb.amritsar",
  "providerName": "twilio",
  "channel": "whatsapp", 
  "credentials": {
    "accountSid": "AC1234...",
    "authToken": "your_token"
  },
  "novuApiKey": "optional_provider_key",
  "isActive": true,
  "priority": 1
}
```

### TemplateBinding Schema  
Maps events to templates per tenant:

```json
{
  "tenantId": "pb.amritsar",
  "eventName": "complaint-assigned",
  "channel": "whatsapp",
  "templateId": "complaint-assigned-whatsapp",
  "contentSid": "HX1234...",
  "paramOrder": ["complaintNo", "assigneeName"],
  "requiredVars": ["complaintNo", "assigneeName"]
}
```

## Security Features
- Credentials marked with `x-security` are encrypted at rest
- API keys are redacted in logs
- Generic credential handling prevents exposure

## Multi-tenant Support
- Each tenant can use different providers for the same channel
- Provider priorities allow fallback configurations  
- Tenant-specific Novu API keys supported

## Configuration Steps

1. **Create MDMS Schemas**: Deploy ProviderDetail and TemplateBinding schemas
2. **Configure Providers**: Add provider configs per tenant using config-service APIs
3. **Map Templates**: Create template bindings for each event/tenant/channel
4. **Test Configuration**: Use validation APIs to verify setup

## Provider Credential Formats

### Twilio
```json
{
  "accountSid": "AC...",
  "authToken": "..."
}
```

### SendGrid  
```json
{
  "apiKey": "SG..."
}
```

### Plivo
```json
{
  "authId": "...",
  "authToken": "..."
}
```

## Benefits
- ✅ No code changes needed for new providers
- ✅ Runtime provider configuration
- ✅ Multi-tenant provider flexibility
- ✅ Encrypted credential storage
- ✅ Provider failover support
- ✅ Novu-native credential handling