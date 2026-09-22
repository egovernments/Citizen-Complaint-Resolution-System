package org.egov.novubridge.service.resolution;

import org.egov.novubridge.web.models.ActorRef;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * {@code EVENT_RECIPIENTS}: the contacts on the event itself, for recipients with no account. An
 * entry with only a userId is hydrated exactly as an actor is.
 */
public class EventRecipientsResolver implements RecipientResolver {

    private final ActorRecipientResolver actorResolver;

    public EventRecipientsResolver(ActorRecipientResolver actorResolver) {
        this.actorResolver = actorResolver;
    }

    @Override
    public String scheme() {
        return AudienceRef.EVENT_RECIPIENTS;
    }

    @Override
    public List<Recipient> resolve(AudienceRef ref, ResolutionContext ctx) {
        List<ActorRef> refs = ctx.event().getRecipients();
        if (refs == null || refs.isEmpty()) {
            return Collections.emptyList();
        }
        List<Recipient> out = new ArrayList<>(refs.size());
        for (ActorRef actor : refs) {
            Recipient recipient = actorResolver.toRecipient(actor, ctx);
            if (recipient != null) {
                out.add(recipient);
            }
        }
        return out;
    }
}
