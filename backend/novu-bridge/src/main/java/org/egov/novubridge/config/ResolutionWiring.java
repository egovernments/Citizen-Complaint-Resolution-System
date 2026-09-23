package org.egov.novubridge.config;

import org.egov.novubridge.repository.DispatchLogRepository;
import org.egov.novubridge.service.DispatchPipelineService;
import org.egov.novubridge.service.resolution.ActorRecipientResolver;
import org.egov.novubridge.service.resolution.EventRecipientsResolver;
import org.egov.novubridge.service.resolution.LocaleProvider;
import org.egov.novubridge.service.resolution.LocalizationProvider;
import org.egov.novubridge.service.resolution.NotificationResolver;
import org.egov.novubridge.service.resolution.PlaceholderResolver;
import org.egov.novubridge.service.resolution.RecipientResolver;
import org.egov.novubridge.service.resolution.TemplateRenderer;
import org.egov.novubridge.service.resolution.UserHydrator;
import org.egov.novubridge.service.resolution.config.NotificationConfigRepository;
import org.egov.novubridge.service.thin.ThinEventHandler;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.List;

/**
 * Wires the module-neutral resolution core. It lives outside {@code service.resolution} so the
 * core stays free of DIGIT clients and deployment config: it takes its settings as constructor
 * arguments. {@link NotificationResolver} is the only {@link ThinEventHandler}; there is no flag.
 */
@Configuration
public class ResolutionWiring {

    @Bean
    public ActorRecipientResolver actorRecipientResolver(UserHydrator hydrator) {
        return new ActorRecipientResolver(hydrator);
    }

    @Bean
    public EventRecipientsResolver eventRecipientsResolver(ActorRecipientResolver actorRecipientResolver) {
        return new EventRecipientsResolver(actorRecipientResolver);
    }

    @Bean
    public TemplateRenderer resolutionTemplateRenderer(NovuBridgeConfiguration config) {
        return new TemplateRenderer(config.getDefaultLocale());
    }

    @Bean
    public PlaceholderResolver placeholderResolver(LocalizationProvider localizationProvider) {
        return new PlaceholderResolver(localizationProvider);
    }

    @Bean
    public NotificationResolver notificationResolver(NotificationConfigRepository configRepository,
                                                     List<RecipientResolver> recipientResolvers,
                                                     LocaleProvider localeProvider,
                                                     PlaceholderResolver placeholderResolver,
                                                     TemplateRenderer templateRenderer,
                                                     DispatchPipelineService dispatchPipelineService,
                                                     DispatchLogRepository dispatchLogRepository,
                                                     NovuBridgeConfiguration config) {
        return new NotificationResolver(configRepository, recipientResolvers, localeProvider,
                placeholderResolver, templateRenderer, dispatchPipelineService, dispatchLogRepository,
                config.getDefaultLocale(),
                config.getNotificationRecipientCap() != null ? config.getNotificationRecipientCap() : 1000);
    }
}
