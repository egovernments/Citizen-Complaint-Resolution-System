package org.egov.novubridge.web.models;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Map;

/**
 * Response for {@code POST /novu-adapter/v1/providers}. Carries the just-created
 * Novu integration as an ALLOWLIST projection (non-secret fields only) — the
 * operator-entered {@code credentials} live only in Novu and are NEVER echoed
 * back here.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ProviderCreateResponse {
    private Map<String, Object> data;
}
