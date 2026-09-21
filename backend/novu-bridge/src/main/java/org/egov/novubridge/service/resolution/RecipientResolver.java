package org.egov.novubridge.service.resolution;

import java.util.List;

/**
 * <b>SPI 1 of 4.</b> Turns one audience reference into the people it names.
 *
 * <p>Resolvers are registered by {@link #scheme()}. A consuming product that keeps its directory
 * somewhere other than egov-user supplies its own {@code ROLE} resolver (or a {@code GROUP} one,
 * if that is what its config says) and the DIGIT implementation steps aside — every DIGIT bean is
 * {@code @ConditionalOnMissingBean} on its interface. Nothing else changes: routing, templates,
 * fan-out, dedupe, gating, the ledger and the provider catalog are all untouched by the swap.
 *
 * <p>{@code ACTOR} and {@code EVENT_RECIPIENTS} ship in this package because they do no I/O — they
 * read the event. A product that supplies contacts on the event therefore needs <b>zero</b>
 * resolver code.
 */
public interface RecipientResolver {

    /** The scheme this resolver answers for: {@code ACTOR}, {@code ROLE}, {@code EVENT_RECIPIENTS}, … */
    String scheme();

    /**
     * Who the reference names.
     *
     * @return never null. An <b>empty list is a legitimate answer</b> — the role has no holders,
     *         the actor was not named — and the caller moves on to the next link of the chain,
     *         or writes a {@code SKIPPED} row. Throwing is for a genuine failure (the directory
     *         is unreachable), which the caller logs and treats as "this audience yielded
     *         nothing", without poisoning its memo.
     */
    List<Recipient> resolve(AudienceRef ref, ResolutionContext ctx);
}
