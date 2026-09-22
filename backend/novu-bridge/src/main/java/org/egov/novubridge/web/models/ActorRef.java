package org.egov.novubridge.web.models;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * A person a {@link ThinEvent} names (an {@code actors} entry or a {@code recipients} element).
 * Prefer {@code userId} alone: the box hydrates the contact, keeping PII off the broker. The
 * contact fields are for recipients with no account and are used as-is. Deliberately not
 * {@link Contact}, which belongs to the frozen v1 envelope. Wire form: {@code actorRef} in
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
