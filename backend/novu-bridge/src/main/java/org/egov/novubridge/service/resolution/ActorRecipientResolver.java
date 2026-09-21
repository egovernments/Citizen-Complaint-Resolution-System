package org.egov.novubridge.service.resolution;

import org.egov.novubridge.web.models.ActorRef;

import java.util.Collections;
import java.util.List;
import java.util.Map;

/**
 * {@code ACTOR:<name>} — the people the producer named, read straight off the event.
 *
 * <p>Built in, and in the module-neutral package, because it does no I/O of its own. A product
 * that supplies contacts on the event therefore needs no resolver code at all; it needs one only
 * if it wants role-pool expansion against its own directory.
 *
 * <p><b>The one rule worth stating.</b> An actor is hydrated from the directory only when the
 * producer gave a {@code userId} and <i>no contact at all</i>. That single rule reproduces both of
 * today's shapes exactly:
 *
 * <ul>
 *   <li>the <b>citizen</b>, whom the producer already holds in full (name, phone, country code,
 *       email, and a uuid that falls back to the account id — a PGR rule that stays in PGR), is
 *       used verbatim and costs no lookup;</li>
 *   <li>the <b>assignee</b>, of whom the producer holds only a uuid, is hydrated — which is how
 *       the phone gets its country code and the email arrives at all.</li>
 * </ul>
 *
 * It is also the rule the published contract already states for producers: <i>send a uuid when the
 * recipient has an account; send contact fields only when they do not.</i>
 *
 * <p>When hydration finds nobody, the actor is returned with what the ref carried. Usually that is
 * a userId and nothing else, so the recipient is unreachable and the caller writes a
 * {@code SKIPPED / NB_CONTACT_MISSING} row against a subscriber id that still identifies the right
 * person. Today's code instead falls back to a second, differently-keyed identity for the same
 * human, which is how one person could end up under two subscriber ids; see the parity test's
 * intended-differences table.
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
        ActorRef actor = lookup(actors, ref.value());
        if (actor == null) {
            return Collections.emptyList();
        }
        Recipient recipient = toRecipient(actor, ctx);
        return recipient == null ? Collections.emptyList() : Collections.singletonList(recipient);
    }

    /**
     * Actor names are matched case-insensitively. The routing column is operator-typed and the
     * event key is producer-typed; making {@code ACTOR:Citizen} miss {@code "citizen"} would be a
     * config trap with a silent failure mode.
     */
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
        boolean carriesContact = hasText(actor.getName()) || hasText(actor.getPhone()) || hasText(actor.getEmail());
        if (hasText(actor.getUserId()) && !carriesContact && hydrator != null) {
            Recipient hydrated = hydrator.hydrate(actor.getUserId().trim(), actor.getType(),
                    ctx.tenantId(), ctx.requestInfo());
            if (hydrated != null) {
                // The ref's own locale override still wins: it is the producer saying something
                // the directory does not know.
                return hasText(actor.getLocale())
                        ? new Recipient(hydrated.userId(), hydrated.type(), hydrated.name(),
                                hydrated.phone(), hydrated.email(), actor.getLocale().trim())
                        : hydrated;
            }
        }
        return new Recipient(trimToNull(actor.getUserId()), actor.getType(), actor.getName(),
                actor.getPhone(), actor.getEmail(), trimToNull(actor.getLocale()));
    }

    private static boolean hasText(String value) {
        return value != null && !value.trim().isEmpty();
    }

    private static String trimToNull(String value) {
        return hasText(value) ? value.trim() : null;
    }
}
