package org.egov.novubridge.service.resolution.digit;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.service.resolution.LocaleProvider;
import org.egov.novubridge.service.resolution.LocalizationProvider;
import org.egov.novubridge.service.resolution.RecipientResolver;
import org.egov.novubridge.service.resolution.UserHydrator;
import org.egov.novubridge.service.resolution.config.NotificationConfigRepository;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.lang.Nullable;
import org.springframework.web.client.RestTemplate;

/**
 * The DIGIT implementations of the resolution SPIs. Each is {@code @ConditionalOnMissingBean} on
 * its interface (declared on the {@code @Bean} method, where Spring evaluates it reliably), so a
 * product swaps one in by declaring its own bean. {@code RestTemplate} is nullable: each client
 * then degrades to "source unavailable" instead of failing startup.
 */
@Configuration
public class DigitResolutionConfiguration {

    @Bean
    public DigitUserSearch digitUserSearch(@Nullable RestTemplate restTemplate,
                                           NovuBridgeConfiguration config) {
        return new DigitUserSearch(restTemplate, config);
    }

    @Bean
    @ConditionalOnMissingBean(NotificationConfigRepository.class)
    public NotificationConfigRepository mdmsNotificationConfigRepository(@Nullable RestTemplate restTemplate,
                                                                        NovuBridgeConfiguration config) {
        return new MdmsNotificationConfigRepository(restTemplate, config);
    }

    @Bean
    @ConditionalOnMissingBean(UserHydrator.class)
    public UserHydrator digitUserHydrator(DigitUserSearch users) {
        return new DigitUserHydrator(users);
    }

    /**
     * Conditioned on the concrete class, not {@code RecipientResolver}: resolvers are a collection,
     * so conditioning on the interface would let any resolver suppress this one. A product
     * replacing ROLE declares a bean of this type, or a later-registered bean with scheme ROLE.
     */
    @Bean
    @ConditionalOnMissingBean(DigitRoleRecipientResolver.class)
    public DigitRoleRecipientResolver digitRoleRecipientResolver(DigitUserSearch users,
                                                                 NovuBridgeConfiguration config) {
        return new DigitRoleRecipientResolver(users, config);
    }

    @Bean
    @ConditionalOnMissingBean(LocaleProvider.class)
    public LocaleProvider digitLocaleProvider(@Nullable RestTemplate restTemplate,
                                              NovuBridgeConfiguration config) {
        return new DigitLocaleProvider(restTemplate, config);
    }

    @Bean
    @ConditionalOnMissingBean(LocalizationProvider.class)
    public LocalizationProvider digitLocalizationProvider(@Nullable RestTemplate restTemplate,
                                                          NovuBridgeConfiguration config) {
        return new DigitLocalizationProvider(restTemplate, config);
    }
}
