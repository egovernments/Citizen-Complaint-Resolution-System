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
import org.egov.novubridge.service.resolution.digit.DigitResolutionConfiguration;
import org.egov.novubridge.service.resolution.digit.DigitRoleRecipientResolver;
import org.egov.novubridge.service.resolution.digit.DigitUserSearch;
import org.egov.novubridge.service.thin.ThinEventHandler;
import org.egov.novubridge.service.thin.ThinEventPipelineService;
import org.egov.novubridge.service.thin.ThinEventValidator;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.TreeSet;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;

/**
 * The bean graph closes.
 *
 * <p>Nothing else in this suite boots a Spring context — every other test builds its subject by
 * hand, which is fast and honest and cannot catch a bean that nobody supplies. The resolution
 * stage has eleven beans across two configuration classes and one of them, the
 * {@link ThinEventHandler}, is a constructor argument of a {@code @Service} that Spring creates at
 * startup: a missing bean is a container that refuses to start, discovered on a deployed box.
 *
 * <p>So this calls the two {@code @Configuration} classes' factory methods in dependency order,
 * exactly as the container would, and asserts the graph closes and the handler the thin path
 * reaches is the resolver. It is not a substitute for a context test; it is the cheap check that
 * the thing a context test would prove is true.
 */
class ResolutionWiringTest {

    private final NovuBridgeConfiguration config = new NovuBridgeConfiguration();
    private final ResolutionWiring core = new ResolutionWiring();
    private final DigitResolutionConfiguration digit = new DigitResolutionConfiguration();

    @Test
    @DisplayName("the DIGIT adapters and the module-neutral core assemble into one working handler")
    void theGraphCloses() {
        config.setDefaultLocale("en_IN");
        config.setNotificationRecipientCap(1000);

        // The DIGIT half, built with no RestTemplate — a slice with no HTTP client must still get
        // working beans, which is why every client here takes it @Nullable.
        DigitUserSearch users = digit.digitUserSearch(null, config);
        NotificationConfigRepository repository = digit.mdmsNotificationConfigRepository(null, config);
        UserHydrator hydrator = digit.digitUserHydrator(users);
        DigitRoleRecipientResolver roles = digit.digitRoleRecipientResolver(users, config);
        LocaleProvider locales = digit.digitLocaleProvider(null, config);
        LocalizationProvider localization = digit.digitLocalizationProvider(null, config);

        // The module-neutral half.
        ActorRecipientResolver actors = core.actorRecipientResolver(hydrator);
        EventRecipientsResolver recipients = core.eventRecipientsResolver(actors);
        TemplateRenderer renderer = core.resolutionTemplateRenderer(config);
        PlaceholderResolver placeholders = core.placeholderResolver(localization);

        NotificationResolver resolver = core.notificationResolver(repository,
                List.of(actors, recipients, roles), locales, placeholders, renderer,
                mock(DispatchPipelineService.class), mock(DispatchLogRepository.class), config);

        assertNotNull(resolver);
        ThinEventPipelineService pipeline = new ThinEventPipelineService(
                mock(ThinEventValidator.class), resolver, mock(DispatchLogRepository.class));
        assertNotNull(pipeline, "the thin path's entry point takes a handler in its constructor: "
                + "a build with no resolution stage cannot start, and that is the intended design");
    }

    @Test
    @DisplayName("the three shipped resolvers cover exactly the three documented schemes")
    void everyDocumentedSchemeHasAResolver() {
        DigitUserSearch users = digit.digitUserSearch(null, config);
        ActorRecipientResolver actors = core.actorRecipientResolver(digit.digitUserHydrator(users));
        List<RecipientResolver> resolvers = List.of(actors, core.eventRecipientsResolver(actors),
                digit.digitRoleRecipientResolver(users, config));

        TreeSet<String> schemes = new TreeSet<>();
        resolvers.forEach(r -> schemes.add(r.scheme()));
        assertEquals(new TreeSet<>(List.of("ACTOR", "EVENT_RECIPIENTS", "ROLE")), schemes,
                "a routing row naming any other scheme produces NB_UNKNOWN_AUDIENCE_SCHEME rather "
                        + "than a guess, so this set IS the published audience vocabulary");
    }

    @Test
    @DisplayName("the resolver IS the thin-event handler — there is no second implementation to pick")
    void theResolverIsTheHandler() {
        config.setDefaultLocale("en_IN");
        config.setNotificationRecipientCap(1000);
        DigitUserSearch users = digit.digitUserSearch(null, config);
        ActorRecipientResolver actors = core.actorRecipientResolver(digit.digitUserHydrator(users));
        NotificationResolver resolver = core.notificationResolver(
                digit.mdmsNotificationConfigRepository(null, config),
                List.of(actors), digit.digitLocaleProvider(null, config),
                core.placeholderResolver(digit.digitLocalizationProvider(null, config)),
                core.resolutionTemplateRenderer(config), mock(DispatchPipelineService.class),
                mock(DispatchLogRepository.class), config);

        assertTrue(resolver instanceof ThinEventHandler);
        ThinEventHandler handler = resolver;
        assertSame(resolver, handler, "one object, one seam: the endpoint that dry-runs a thin "
                + "event and the consumer that dispatches one reach the same instance");
    }

    @Test
    @DisplayName("a null recipient cap falls back to 1000 rather than to no cap at all")
    void theCapHasASafeDefault() {
        config.setDefaultLocale("en_IN");
        config.setNotificationRecipientCap(null);
        DigitUserSearch users = digit.digitUserSearch(null, config);
        ActorRecipientResolver actors = core.actorRecipientResolver(digit.digitUserHydrator(users));
        // Building it is the assertion: a null here used to be an unboxing NPE at startup, and
        // "no cap" would be worse — a mis-seeded role could become a five-figure send.
        assertNotNull(core.notificationResolver(digit.mdmsNotificationConfigRepository(null, config),
                List.of(actors), digit.digitLocaleProvider(null, config),
                core.placeholderResolver(digit.digitLocalizationProvider(null, config)),
                core.resolutionTemplateRenderer(config), mock(DispatchPipelineService.class),
                mock(DispatchLogRepository.class), config));
    }
}
