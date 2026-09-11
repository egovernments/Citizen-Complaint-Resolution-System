package org.egov.novubridge.web.models;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;
import java.util.Map;

/**
 * Read-only view of Novu provider integrations for the configurator's
 * Notification Providers screen. Each entry is the Novu integration object with
 * any {@code credentials} values masked to {@code "***"} — raw secrets are never
 * surfaced to the keyless SPA.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class IntegrationListResponse {
    private List<Map<String, Object>> data;
    private Long total;
}
