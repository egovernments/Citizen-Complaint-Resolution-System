# decrypt_data

> Decrypt encrypted data using the DIGIT encryption service.

**Group:** `encryption` | **Risk:** `write` | **DIGIT Service:** `egov-enc-service`

## Description

Decrypts one or more encrypted values that were previously encrypted by the DIGIT encryption service. This is the reverse operation of `encrypt_data` and is used to retrieve the original plain text from encrypted strings stored in the DIGIT database.

Many DIGIT services store sensitive fields (mobile numbers, email addresses, personal identifiers) in encrypted form. When you need to inspect or verify this data, `decrypt_data` converts the opaque encrypted strings back to readable values.

Decryption may fail if the encryption key is not configured for the specified tenant or if the encrypted values were produced by a different encryption service instance with different keys. The service does not require user authentication -- it manages its own key infrastructure.

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `tenant_id` | string | yes | -- | Tenant ID for decryption context (e.g. `"pg"`, `"pg.citya"`) |
| `encrypted_values` | array of strings | yes | -- | Encrypted strings to decrypt (as returned by `encrypt_data`) |

## Response

Returns an array of decrypted plain text strings in the same order as the input.

```json
{
  "decrypted_values": [
    "9876543210",
    "john.doe@example.com"
  ]
}
```

## Examples

### Basic Usage

Decrypt a single encrypted value:

```
decrypt_data({
  tenant_id: "pg",
  encrypted_values: ["eyJhbGciOiJSU0EtT0FFUC0yNTYiLC..."]
})
```

### Multiple Values

Decrypt several encrypted fields at once:

```
decrypt_data({
  tenant_id: "pg",
  encrypted_values: [
    "eyJhbGciOiJSU0EtT0FFUC0yNTYiLC...",
    "mK9pLzRfT3hWdE1nQ2JOa0ZISXVPR...",
    "Qk5WcDdyS1RKZlhNbHBCd0xhRjN..."
  ]
})
```

### Inspect Encrypted User Data

When debugging user records that contain encrypted fields:

```
// Step 1: Search for a user
user_search({
  tenant_id: "pg.citya",
  mobile_number: "9876543210"
})
// Response may contain encrypted fields

// Step 2: Decrypt the encrypted mobile number from the record
decrypt_data({
  tenant_id: "pg",
  encrypted_values: ["<encrypted_mobile_from_user_record>"]
})
```

## Errors

| Error | Cause | Fix |
|-------|-------|-----|
| Decryption failed | Encryption key not configured for the tenant | Ensure the encryption service has keys provisioned for this tenant |
| Invalid encrypted value | The input string is not a valid encrypted payload | Verify the value came from `encrypt_data` or a DIGIT service's encrypted field |
| Key mismatch | Value was encrypted under a different tenant or service instance | Use the same `tenant_id` that was used during encryption |
| Service unavailable | `egov-enc-service` is not running | Check service health with `health_check` |

## See Also

- [encrypt_data](encrypt_data.md) -- encrypt plain text values using this service
