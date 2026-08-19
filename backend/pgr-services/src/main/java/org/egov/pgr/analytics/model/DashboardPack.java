package org.egov.pgr.analytics.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;

import java.util.List;

@Data
@JsonIgnoreProperties(ignoreUnknown = true)
public class DashboardPack {
    private String id;
    private String description;

    /**
     * The action URL a caller must be granted for this pack to match them — the pack's persona gate
     * since #1050, replacing {@code roles}. Which dashboard a user gets is now decided by the same
     * grant that decides whether they may query at all.
     */
    private String requiredActionUrl;

    /** The anonymous pack. Selected only on the public surface, never by an employee grant. */
    private boolean publicPack;
    private List<String> tiles;
    private List<LayoutEntry> layout;

    @Data
    @JsonIgnoreProperties(ignoreUnknown = true)
    public static class LayoutEntry {
        private String kpiId;
        private int x, y, w, h;
    }

    @JsonProperty("public")
    public boolean isPublicPack() { return publicPack; }

    @JsonProperty("public")
    public void setPublicPack(boolean publicPack) { this.publicPack = publicPack; }
}
