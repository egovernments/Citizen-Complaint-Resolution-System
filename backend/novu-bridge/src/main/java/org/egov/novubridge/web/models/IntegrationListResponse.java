package org.egov.novubridge.web.models;

import com.fasterxml.jackson.annotation.JsonInclude;
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
    /**
     * Whose notification account {@code data} lists (#2203): {@code mode} TENANT (the workspace's own
     * Novu organization) or SHARED, the workspace's provisioning {@code status}, and whether the
     * caller may manage it. Absent on a bridge without per-tenant accounts wired.
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    private Map<String, Object> account;
}
