package org.egov.pgr.analytics.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.Data;

import java.util.List;
import java.util.Set;

@Data
@JsonIgnoreProperties(ignoreUnknown = true)
public class DashboardPack {
    private String id;
    private String description;
    private List<String> roles;
    private List<String> tiles;
    private List<LayoutEntry> layout;

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class LayoutEntry {
        private String kpiId;
        private int x, y, w, h;
    }

    public boolean matchesRoles(Set<String> callerRoles) {
        return roles != null && roles.stream().anyMatch(callerRoles::contains);
    }
}
