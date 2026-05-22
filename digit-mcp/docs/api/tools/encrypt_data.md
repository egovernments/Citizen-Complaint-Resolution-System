# encrypt_data

> Encrypt sensitive data using the DIGIT encryption service.

**Group:** `encryption` | **Risk:** `write` | **DIGIT Service:** `egov-enc-service`

## Description

Encrypts one or more plain text values using the DIGIT platform's encryption service. The service manages its own encryption keys and provides a consistent encryption interface used across DIGIT modules to protect sensitive data such as mobile numbers, Aadhaar numbers, and personal identifiers.

Unlike most DIGIT tools, this service does not require user authentication -- the encryption service handles its own key management independently. This makes it usable for data protection operations without needing to call `configure` first.

Encrypted values are opaque strings that can only be decrypted by the same DIGIT encryption service instance using `decrypt_data`. The encryption is tenant-scoped, meaning values encrypted under one tenant's context may not be decryptable under a different tenant if key configurations differ.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `tenant_id` | string | yes | -- | Tenant ID for encryption context (e.g. `"pg"`, `"pg.citya"`) |
| `values` | array of strings | yes | -- | Plain text values to encrypt |

## Response

Returns an array of encrypted strings in the same order as the input values.

```json
{
  "encrypted_values": [
    "eyJhbGciOiJSU0EtT0FFUC0yNTYiLC...",
    "mK9pLzRfT3hWdE1nQ2JOa0ZISXVPR..."
  ]
}
```

## Examples

### Basic Usage

Encrypt a single mobile number:

```
encrypt_data({
  tenant_id: "pg",
  values: ["9876543210"]
})
```

### Multiple Values

Encrypt several sensitive fields at once:

```
encrypt_data({
  tenant_id: "pg",
  values: [
    "9876543210",
    "john.doe@example.com",
    "123 Main Street"
  ]
})
```

### Round-Trip Verification

Encrypt and then decrypt to verify the service is working:

```
// Step 1: Encrypt
encrypt_data({
  tenant_id: "pg",
  values: ["test-value-12345"]
})
// Returns: ["eyJhbGciOi..."]

// Step 2: Decrypt
decrypt_data({
  tenant_id: "pg",
  encrypted_values: ["eyJhbGciOi..."]
})
// Returns: ["test-value-12345"]
```

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| Encryption key not configured | Tenant has no encryption key set up | Verify the tenant exists and the encryption service is properly configured for this environment |
| Service unavailable | `egov-enc-service` is not running | Check service health with `health_check` |

## See Also

- [decrypt_data](decrypt_data.md) -- decrypt values encrypted by this service
