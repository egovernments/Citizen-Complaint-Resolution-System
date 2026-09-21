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
 * The module-neutral half of the resolution stage, wired.
 *
 * <p>It lives OUTSIDE {@code org.egov.novubridge.service.resolution} on purpose, and that is the
 * one structural decision in this file. The core package is asserted by
 * {@code ResolutionPackageIsolationTest} to reference no DIGIT client and no deployment
 * configuration; a {@code @Configuration} class inside it would have to read
 * {@link NovuBridgeConfiguration} to know the default locale and the fan-out cap, and the
 * isolation rule would immediately need its first exception. Keeping the wiring here means the
 * rule has none: the core takes its settings as constructor arguments, from whoever builds it,
 * which is also what makes it straightforward to construct in a test with no Spring at all.
 *
 * <p>{@link NotificationResolver} IS the build's {@link ThinEventHandler}, and it is the only
 * one. There is no flag and no alternative implementation: {@code ThinEventPipelineService}
 * requires a handler in its constructor, so a build that somehow lost this bean would fail to
 * start and say why, rather than accept thin events and record them as undeliverable. A path
 * that can be switched off by omission is the failure mode this design refuses.
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
