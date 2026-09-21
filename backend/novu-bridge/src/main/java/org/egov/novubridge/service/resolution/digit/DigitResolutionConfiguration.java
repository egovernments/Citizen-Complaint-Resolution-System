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
 * The DIGIT half of the resolution stage, wired.
 *
 * <p><b>Every bean here is {@code @ConditionalOnMissingBean} on its INTERFACE.</b> That is the
 * entire swap mechanism and it is worth being precise about what it buys: a consuming product
 * registers its own {@link RecipientResolver} with {@code scheme() == "ROLE"}, or its own
 * {@link LocaleProvider}, or its own {@link NotificationConfigRepository}, and the DIGIT one
 * simply is not created. It needs no flag, no profile and no edit to this file.
 *
 * <p>The condition is declared on {@code @Bean} methods rather than as annotations on the classes
 * because that is where Spring evaluates it reliably; on a component scan it holds only
 * incidentally, and "incidentally" is not a property to build a seam on.
 *
 * <p>{@code RestTemplate} is {@code @Nullable} throughout for the same reason the existing DIGIT
 * clients take it that way: a slice test that builds none must still get a working bean, and each
 * client degrades to "this source is unavailable" rather than failing to start.
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
     * Note the condition: on {@code DigitRoleRecipientResolver}, not on {@code RecipientResolver}.
     * Resolvers are a collection — the box always has {@code ACTOR} and
     * {@code EVENT_RECIPIENTS} too — so conditioning on the interface would mean the first
     * resolver registered anywhere suppressed all the others. A product replacing the role pool
     * declares a bean of this type, or names its scheme {@code ROLE} on a bean of its own and
     * accepts that the later registration wins in
     * {@code NotificationResolver}'s scheme map.
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
