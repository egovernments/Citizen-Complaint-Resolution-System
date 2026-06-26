package org.egov.pgr.analytics.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import lombok.Data;

import java.util.Collections;
import java.util.List;
import java.util.Set;

@Data
@JsonIgnoreProperties(ignoreUnknown = true)
public class KpiDefinition {
    private String id;
    private String version;
    private String status;
    private JsonNode query;
    private KpiViz viz;
    private List<KpiParam> params;
    private KpiRbac rbac;

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class KpiViz {
        private String kind;
        private String format;
        private String valueKey;
        private String accent;
        private String group;
        private String titleKey;
        private String dimensionKey;
        private List<String> measureKeys;
        private List<KpiVariant> variants;
        private JsonNode compose;
        private JsonNode pii;
    }

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class KpiParam {
        private String name;
        private String defaultValue;

        @JsonProperty("default")
        public String getDefaultValue() { return defaultValue; }

        @JsonProperty("default")
        public void setDefaultValue(String v) { this.defaultValue = v; }

        private List<String> allowed;
    }

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class KpiVariant {
        private String id;
        private String labelKey;
        private boolean defaultVariant;

        @JsonProperty("default")
        public boolean isDefaultVariant() { return defaultVariant; }

        @JsonProperty("default")
        public void setDefaultVariant(boolean v) { this.defaultVariant = v; }
    }

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class KpiRbac {
        private List<String> visibleTo = Collections.emptyList();
    }

    public boolean isPublished() { return "published".equals(status); }

    public boolean isVisibleTo(Set<String> callerRoles) {
        if (rbac == null || rbac.getVisibleTo() == null || rbac.getVisibleTo().isEmpty()) return true;
        return rbac.getVisibleTo().stream().anyMatch(callerRoles::contains);
    }
}
