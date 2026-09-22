package org.egov.novubridge.web.models;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * A person a {@link ThinEvent} names: an entry in its {@code actors} map, or an element of its
 * {@code recipients} array. The two are the same shape on the wire and the same class here.
 *
 * <p><b>{@code userId} alone is the form to prefer.</b> The box hydrates name, phone, email and
 * preferred locale from egov-user, which is what keeps contact PII off the broker — a role
 * notification to a forty-person pool now puts zero phone numbers on a Kafka topic. The other
 * fields exist for recipients who have <b>no account</b>: an anonymously filed complaint, an OTP
 * target. Whatever is supplied here is used as-is and not looked up.
 *
 * <p>Deliberately NOT {@link Contact}, although the field sets coincide today. {@code Contact} is
 * part of the pre-rendered envelope v1, where it means "the recipient the producer already
 * resolved"; this means "a handle the box will resolve". Sharing a class would make a change to
 * either contract a change to both, and envelope v1 is frozen on purpose.
 *
 * <p><b>Published contract.</b> The wire form is the {@code actorRef} definition in
 * {@code contract/thin-event-v1.schema.json}; a field added here must be described there.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ActorRef {

    /** User uuid. Enough on its own — everything below is hydrated from it. */
    private String userId;

    /** CITIZEN | EMPLOYEE by convention. Informational; routing keys on the audience ref. */
    private String type;

    /** Display name, for a recipient with no account. */
    private String name;

    /** E.164 with country code, for a recipient with no account. */
    private String phone;

    /** For a recipient with no account. */
    private String email;

    /** Overrides the locale the box would read from user preferences. */
    private String locale;
}
