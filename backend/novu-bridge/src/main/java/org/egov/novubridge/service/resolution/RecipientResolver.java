package org.egov.novubridge.service.resolution;

import java.util.List;

/**
 * SPI: one audience reference to the people it names, registered by {@link #scheme()}. A product
 * with its own directory supplies its own {@code ROLE} resolver; nothing else changes.
 */
public interface RecipientResolver {

    /** {@code ACTOR}, {@code ROLE}, {@code EVENT_RECIPIENTS}, ... */
    String scheme();

    /**
     * @return never null; empty is a legitimate answer (nobody holds the role).
     * @throws RuntimeException when the directory cannot be read. Never return empty for a
     *         failure: empty is recorded as NB_NO_RECIPIENTS and never retried, a throw is DLQ'd.
     * @throws RecipientLimitExceededException when the audience is larger than the resolver will
     *         read; the event is refused rather than partially sent
     */
    List<Recipient> resolve(AudienceRef ref, ResolutionContext ctx);
}
