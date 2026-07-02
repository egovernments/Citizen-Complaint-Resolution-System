package org.egov.novubridge.config;

import jakarta.annotation.PostConstruct;
import lombok.Data;
import org.egov.tracer.config.TracerConfiguration;
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

    @Value("${novu.bridge.max.retries:3}")
    private Integer maxRetries;

    @Value("${novu.bridge.preference.enabled:true}")
    private Boolean preferenceEnabled;

    @Value("${novu.bridge.preference.host:http://localhost:8080/user-preferences}")
    private String preferenceHost;

    @Value("${novu.bridge.preference.check.path:/v1/_search}")
    private String preferenceCheckPath;

    @Value("${novu.bridge.config.host:http://localhost:9000}")
    private String configHost;

    @Value("${novu.bridge.config.resolve.path:/config-service/config/v1/_resolve}")
    private String configResolvePath;

    @Value("${novu.bridge.config.search.path:/config-service/config/v1/_search}")
    private String configSearchPath;

    @Value("${novu.bridge.preference.code:USER_NOTIFICATION_PREFERENCES}")
    private String preferenceCode;

    @Value("${novu.bridge.user.host:http://localhost:8081}")
    private String userHost;

    @Value("${novu.bridge.user.search.path:/user/_search}")
    private String userSearchPath;

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

    // ---- Baileys WhatsApp send-service (out-of-band HTTP delivery) ----
    @Value("${novu.bridge.whatsapp.baileys.url:http://baileys-send-service:3040}")
    private String baileysUrl;

    @Value("${novu.bridge.whatsapp.baileys.send.path:/send}")
    private String baileysSendPath;

    @Value("${novu.bridge.whatsapp.baileys.token:}")
    private String baileysToken;

    @Value("${novu.bridge.whatsapp.baileys.timeout.ms:10000}")
    private Integer baileysTimeoutMs;

    /**
     * Resolve the fixed Novu workflow id for a channel. The rendered body
     * always travels in payload.body; the workflow just relays it.
     */
    public String getNovuWorkflowId(String channel) {
        if (channel == null) {
            return novuWorkflowSms;
        }
        switch (channel.toUpperCase()) {
            case "WHATSAPP":
                return novuWorkflowWhatsapp;
            case "EMAIL":
                return novuWorkflowEmail;
            case "SMS":
            default:
                return novuWorkflowSms;
        }
    }

    @PostConstruct
    public void initialize() {
        TimeZone.setDefault(TimeZone.getTimeZone(timeZone));
    }
}
