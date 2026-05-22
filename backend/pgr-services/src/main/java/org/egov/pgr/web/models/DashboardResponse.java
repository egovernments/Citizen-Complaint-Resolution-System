package org.egov.pgr.web.models;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.util.List;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DashboardResponse {

    @JsonProperty("kpi")
    private DashboardKpi kpi;

    @JsonProperty("monthly")
    private List<DashboardMonthly> monthly;

    @JsonProperty("monthly_source")
    private List<DashboardMonthlySource> monthlySource;

    @JsonProperty("dimensions")
    private List<DashboardDimension> dimensions;

    @JsonProperty("departments")
    private List<DashboardDepartment> departments;

    @JsonProperty("refreshed_at")
    private String refreshedAt;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class DashboardKpi {
        @JsonProperty("total")
        private int total;

        @JsonProperty("closed")
        private int closed;

        @JsonProperty("completion_rate")
        private BigDecimal completionRate;

        @JsonProperty("avg_resolution_days")
        private BigDecimal avgResolutionDays;

        @JsonProperty("unique_citizens")
        private int uniqueCitizens;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class DashboardMonthly {
        @JsonProperty("month_label")
        private String monthLabel;

        @JsonProperty("month_date")
        private String monthDate;

        @JsonProperty("total")
        private int total;

        @JsonProperty("closed")
        private int closed;

        @JsonProperty("open_count")
        private int openCount;

        @JsonProperty("unique_citizens")
        private int uniqueCitizens;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class DashboardMonthlySource {
        @JsonProperty("month_label")
        private String monthLabel;

        @JsonProperty("month_date")
        private String monthDate;

        @JsonProperty("source")
        private String source;

        @JsonProperty("total")
        private int total;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class DashboardDimension {
        @JsonProperty("dimension")
        private String dimension;

        @JsonProperty("dim_value")
        private String dimValue;

        @JsonProperty("total")
        private int total;

        @JsonProperty("closed")
        private int closed;

        @JsonProperty("open_count")
        private int openCount;

        @JsonProperty("avg_resolution_days")
        private BigDecimal avgResolutionDays;

        @JsonProperty("completion_rate")
        private BigDecimal completionRate;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class DashboardDepartment {
        @JsonProperty("department")
        private String department;

        @JsonProperty("total")
        private int total;

        @JsonProperty("closed")
        private int closed;

        @JsonProperty("open_count")
        private int openCount;

        @JsonProperty("avg_resolution_days")
        private BigDecimal avgResolutionDays;

        @JsonProperty("completion_rate")
        private BigDecimal completionRate;
    }
}
