package org.egov.pgr.analytics.model;

import com.fasterxml.jackson.annotation.JsonAnyGetter;
import com.fasterxml.jackson.annotation.JsonAnySetter;
import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.JsonNode;
import lombok.Data;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
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

        /**
         * Overflow bucket for catalog-driven viz descriptor fields the FE render engine
         * (KpiTile) understands but that aren't first-class on this POJO — e.g.
         * {@code threshold}, {@code delta}, {@code dateKey}, {@code sparklineMeasureKey},
         * {@code seriesColor}, {@code contextLabel}, {@code deltaLabel}, {@code colors},
         * {@code stackSeries}, {@code columns}. These are passed through verbatim from the
         * MDMS def to the {@code /packs} and {@code /catalog} responses so the dashboard
         * stays purely catalog-driven (no per-field BE schema change for new viz options).
         */
        @JsonIgnore
        private final Map<String, JsonNode> extra = new LinkedHashMap<>();

        @JsonAnyGetter
        public Map<String, JsonNode> getExtra() { return extra; }

        @JsonAnySetter
        public void putExtra(String key, JsonNode value) { extra.put(key, value); }
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
