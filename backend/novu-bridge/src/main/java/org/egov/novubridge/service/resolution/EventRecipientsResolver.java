package org.egov.novubridge.service.resolution;

import org.egov.novubridge.web.models.ActorRef;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * {@code EVENT_RECIPIENTS} — the contacts the producer put on the event itself.
 *
 * <p>The account-less path: an anonymously filed complaint, an OTP to a number that has no user
 * record yet. The whole reason this scheme exists is that some recipients cannot be named by uuid,
 * and pretending otherwise would push "look this person up somehow" into the box.
 *
 * <p>Built in, in the module-neutral package, because it does no I/O. An entry with a
 * {@code userId} and no contact is still hydrated, exactly as an actor is, so a producer can mix
 * both forms in one list.
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
