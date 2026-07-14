package org.egov.novubridge.web.models;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Read-only page of delivery logs for the configurator's Notification Logs
 * screen. {@code data} holds the current page of rows; {@code total} is the
 * unpaged COUNT for the same tenant + filters so the UI paginator stays honest.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DispatchLogListResponse {
    private List<DispatchLogEntry> data;
    private Long total;
}
