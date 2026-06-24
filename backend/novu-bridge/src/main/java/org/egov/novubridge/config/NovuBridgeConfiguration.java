package org.egov.novubridge.config;

import jakarta.annotation.PostConstruct;
import lombok.Data;
import org.egov.tracer.config.TracerConfiguration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Import;
import org.springframework.stereotype.Component;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.TimeZone;
import java.util.stream.Collectors;

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

    // Global channel allow-list for dispatch, as a comma-separated value
    // (e.g. "whatsapp" or "whatsapp,sms"). This is the deployment-wide guard:
    // a tenant can only dispatch on a channel that is BOTH enabled in its
    // NotificationChannel config AND present here. Lets ops keep a channel
    // globally paused (e.g. SMS pending Twilio A2P) regardless of tenant
    // toggles. Override via NOVU_BRIDGE_CHANNEL env.
    @Value("${novu.bridge.channel:whatsapp}")
    private String channel;

    /**
     * The {@link #channel} CSV parsed into a normalised (lowercase, de-duped) allow-list.
     * Channel codes are compared lowercase everywhere so they match the lowercase
     * channel values used in ProviderDetail/TemplateBinding seed data and the
     * lowercased NotificationChannel.code values.
     */
    public List<String> getAllowedChannels() {
        if (channel == null) {
            return Collections.emptyList();
        }
        return Arrays.stream(channel.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .map(s -> s.toLowerCase())
                .distinct()
                .collect(Collectors.toList());
    }

    @Value("${novu.bridge.default.locale:en_IN}")
    private String defaultLocale;

    @Value("${novu.bridge.max.retries:3}")
    private Integer maxRetries;

    // Fixed backoff applied before reprocessing a message consumed from the retry topic, so a brief
    // downstream outage (e.g. config-service) gets spacing between attempts instead of burning all
    // retries instantly. Bounded by maxRetries. 0 disables the wait (used in tests).
    @Value("${novu.bridge.retry.delay.ms:5000}")
    private Integer retryDelayMs;

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

    @PostConstruct
    public void initialize() {
        TimeZone.setDefault(TimeZone.getTimeZone(timeZone));
    }
}
