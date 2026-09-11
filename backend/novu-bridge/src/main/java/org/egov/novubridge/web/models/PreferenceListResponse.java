package org.egov.novubridge.web.models;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

/**
 * Read-only view of user notification preferences for the configurator's User
 * Preferences screen. Each entry is an allowlist projection of a preference
 * record carrying only the userId (a uuid, not PII), the tenantId, the
 * preferredLanguage and the per-channel consent map ({@code {status, scope}} per
 * channel) — no secrets and no PII are surfaced to the keyless SPA.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class PreferenceListResponse {
    private List<Map<String, Object>> data;
    private Long total;
}
