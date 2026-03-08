declare const loadCallbacks: (useAttribution?: boolean) => {
    onLCP: (onReport: (metric: import("web-vitals").LCPMetricWithAttribution) => void, opts?: import("web-vitals").AttributionReportOpts) => void;
    onCLS: (onReport: (metric: import("web-vitals").CLSMetricWithAttribution) => void, opts?: import("web-vitals").AttributionReportOpts) => void;
    onFCP: (onReport: (metric: import("web-vitals").FCPMetricWithAttribution) => void, opts?: import("web-vitals").AttributionReportOpts) => void;
    onINP: (onReport: (metric: import("web-vitals").INPMetricWithAttribution) => void, opts?: import("web-vitals").INPAttributionReportOpts) => void;
} | {
    onLCP: (onReport: (metric: import("web-vitals").LCPMetric) => void, opts?: import("web-vitals").ReportOpts) => void;
    onCLS: (onReport: (metric: import("web-vitals").CLSMetric) => void, opts?: import("web-vitals").ReportOpts) => void;
    onFCP: (onReport: (metric: import("web-vitals").FCPMetric) => void, opts?: import("web-vitals").ReportOpts) => void;
    onINP: (onReport: (metric: import("web-vitals").INPMetric) => void, opts?: import("web-vitals").INPReportOpts) => void;
};
export default loadCallbacks;
