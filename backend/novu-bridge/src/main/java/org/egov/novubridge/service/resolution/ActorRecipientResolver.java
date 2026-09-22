package org.egov.novubridge.service.resolution;

import org.egov.novubridge.web.models.ActorRef;
import org.springframework.util.StringUtils;

import java.util.Collections;
import java.util.List;
import java.util.Map;

/**
 * {@code ACTOR:<name>}: the people the producer named on the event.
 *
 * <p>An actor is hydrated from the directory only when it carries a userId and NO contact at all;
 * contact fields exist for account-less recipients and are used verbatim. When hydration finds
 * nobody, the actor is returned as given (usually unreachable, so NB_CONTACT_MISSING against the
 * right subscriber id) rather than keyed under a second identity.
 */
public class ActorRecipientResolver implements RecipientResolver {

    private final UserHydrator hydrator;

    public ActorRecipientResolver(UserHydrator hydrator) {
        this.hydrator = hydrator;
    }

    @Override
    public String scheme() {
        return AudienceRef.ACTOR;
    }

    @Override
    public List<Recipient> resolve(AudienceRef ref, ResolutionContext ctx) {
        Map<String, ActorRef> actors = ctx.event().getActors();
        if (actors == null || actors.isEmpty()) {
            return Collections.emptyList();
        }
        Recipient recipient = toRecipient(lookup(actors, ref.value()), ctx);
        return recipient == null ? Collections.emptyList() : Collections.singletonList(recipient);
    }

    /** Case-insensitive: the routing column is operator-typed, the actor key producer-typed. */
    private static ActorRef lookup(Map<String, ActorRef> actors, String name) {
        ActorRef exact = actors.get(name);
        if (exact != null) {
            return exact;
        }
        for (Map.Entry<String, ActorRef> entry : actors.entrySet()) {
            if (entry.getKey() != null && entry.getKey().equalsIgnoreCase(name)) {
                return entry.getValue();
            }
        }
        return null;
    }

    Recipient toRecipient(ActorRef actor, ResolutionContext ctx) {
        if (actor == null) {
            return null;
        }
        boolean carriesContact = StringUtils.hasText(actor.getName()) || StringUtils.hasText(actor.getPhone())
                || StringUtils.hasText(actor.getEmail());
        if (StringUtils.hasText(actor.getUserId()) && !carriesContact && hydrator != null) {
            Recipient hydrated = hydrator.hydrate(actor.getUserId().trim(), actor.getType(),
                    ctx.event().getTenantId(), ctx.requestInfo());
            if (hydrated != null) {
                // The ref's own locale still wins over the directory's.
                return StringUtils.hasText(actor.getLocale())
                        ? new Recipient(hydrated.userId(), hydrated.type(), hydrated.name(),
                                hydrated.phone(), hydrated.email(), actor.getLocale().trim())
                        : hydrated;
            }
        }
        return new Recipient(trimToNull(actor.getUserId()), actor.getType(), actor.getName(),
                actor.getPhone(), actor.getEmail(), trimToNull(actor.getLocale()));
    }

    private static String trimToNull(String value) {
        return StringUtils.hasText(value) ? value.trim() : null;
    }
}
