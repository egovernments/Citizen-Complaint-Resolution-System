package org.egov.novubridge.config;

import jakarta.annotation.PostConstruct;
import lombok.Data;
import org.egov.tracer.config.TracerConfiguration;
import org.egov.tracer.model.CustomException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Import;
import org.springframework.stereotype.Component;

import java.util.TimeZone;

@Component
@Data
@Import({TracerConfiguration.class})
public class NovuBridgeConfiguration {

    @Value("${app.timezone:UTC}")
    private String timeZone;

    @Value("${novu.bridge.kafka.input.topic:complaints.domain.events}")
    private String inputTopic;

    // Retry topic is reserved for future use — nothing publishes to it yet.
    @Value("${novu.bridge.kafka.retry.topic:novu-bridge.retry}")
    private String retryTopic;

    @Value("${novu.bridge.kafka.dlq.topic:novu-bridge.dlq}")
    private String dlqTopic;

    // Default channel for dispatch. SMS is the safer default — works
    // with any Twilio SMS-capable sender out of the box. WhatsApp
    // requires a pre-approved Twilio Programmable WhatsApp sender
    // (sandbox or production). Override via NOVU_BRIDGE_CHANNEL env.
    @Value("${novu.bridge.channel:SMS}")
    private String channel;

    @Value("${novu.bridge.default.locale:en_IN}")
    private String defaultLocale;

    @Value("${novu.bridge.preference.enabled:true}")
    private Boolean preferenceEnabled;

    @Value("${novu.bridge.preference.host:http://localhost:8080/user-preferences}")
    private String preferenceHost;

    @Value("${novu.bridge.preference.check.path:/v1/_search}")
    private String preferenceCheckPath;

    // Full search endpoint (returns the preferences list). The check path above
    // may point at a boolean-consent endpoint (e.g. /_check) on some deployments;
    // the configurator's read-only listing always needs _search.
    @Value("${novu.bridge.preference.search.path:/user-preference/v1/_search}")
    private String preferenceSearchPath;

    @Value("${novu.bridge.preference.code:USER_NOTIFICATION_PREFERENCES}")
    private String preferenceCode;

    @Value("${novu.bridge.user.host:http://localhost:8081}")
    private String userHost;

    @Value("${novu.bridge.user.search.path:/user/_search}")
    private String userSearchPath;

    // ---- Proxy auth: validate the DIGIT bearer token server-side ----
    // The read-only configurator proxy GETs (/novu-adapter/v1/logs|integrations)
    // are authenticated INSIDE this service (ProxyAuthFilter): the bearer token is
    // introspected against egov-user POST /user/_details, then gated on
    // type==EMPLOYEE + at least one role code in the allowlist below.
    @Value("${novu.bridge.proxy.auth.enabled:true}")
    private Boolean proxyAuthEnabled;

    @Value("${novu.bridge.user.details.path:/user/_details}")
    private String userDetailsPath;

    @Value("#{'${novu.bridge.proxy.allowed.roles:EMPLOYEE,SUPERUSER,GRO,PGR_LME}'.split(',')}")
    private java.util.List<String> proxyAllowedRoles;

    @Value("${mdms.host:http://localhost:8082}")
    private String mdmsHost;

    @Value("${mdms.search.path:/egov-mdms-service/v2/_search}")
    private String mdmsSearchPath;

    @Value("${novu.base.url:http://localhost:3000}")
    private String novuBaseUrl;

    @Value("${novu.api.key:test-api-key}")
    private String novuApiKey;

    @Value("${novu.bridge.dispatch.log.enabled:true}")
    private Boolean dispatchLogEnabled;

    // ---- Config-driven pass-through: per-channel Novu workflow ids ----
    // PGR pre-renders the body; novu-bridge triggers a fixed per-channel
    // workflow whose step simply emits payload.body. One workflow per channel.
    @Value("${novu.bridge.workflow.id.sms:complaints-sms}")
    private String novuWorkflowSms;

    @Value("${novu.bridge.workflow.id.whatsapp:complaints-whatsapp}")
    private String novuWorkflowWhatsapp;

    @Value("${novu.bridge.workflow.id.email:complaints-email}")
    private String novuWorkflowEmail;

    // ---- Subscriber identify (upsert) TTL cache ----
    @Value("${novu.bridge.identify.cache.ttl.ms:300000}")
    private Long identifyCacheTtlMs;

    // ---- Channel delivery gate ----
    // Only channels listed here are actually delivered. Any other KNOWN channel
    // (e.g. WHATSAPP until a legitimate provider is onboarded as a Novu
    // integration) is persisted as SKIPPED / NB_NO_PROVIDER — an honest,
    // debuggable outcome, never a fallback to another channel.
    @Value("#{'${novu.bridge.channels.enabled:SMS,EMAIL}'.split(',')}")
    private java.util.List<String> channelsEnabled;

    public boolean isChannelEnabled(String channel) {
        if (channel == null) return false;
        return channelsEnabled.stream().anyMatch(c -> c.trim().equalsIgnoreCase(channel.trim()));
    }

    /**
     * Resolve the fixed Novu workflow id for a channel. Throws for null/unknown
     * channels — callers must gate on a known channel first (the pipeline
     * persists SKIPPED/NB_UNSUPPORTED_CHANNEL instead of ever reaching this
     * throw in normal operation). NEVER defaults to the SMS workflow.
     */
    public String getNovuWorkflowId(String channel) {
        if (channel == null) {
            throw new CustomException("NB_UNSUPPORTED_CHANNEL", "channel is null; refusing to guess a Novu workflow");
        }
        switch (channel.toUpperCase()) {
            case "SMS":      return novuWorkflowSms;
            case "WHATSAPP": return novuWorkflowWhatsapp;
            case "EMAIL":    return novuWorkflowEmail;
            default:
                throw new CustomException("NB_UNSUPPORTED_CHANNEL", "No Novu workflow for channel: " + channel);
        }
    }

    @PostConstruct
    public void initialize() {
        TimeZone.setDefault(TimeZone.getTimeZone(timeZone));
    }
}
