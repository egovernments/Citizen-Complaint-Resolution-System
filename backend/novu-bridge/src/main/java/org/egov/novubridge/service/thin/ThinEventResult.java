package org.egov.novubridge.service.thin;

import lombok.Builder;
import lombok.Data;
import org.egov.novubridge.web.models.DispatchResult;

import java.util.Collections;
import java.util.List;

/**
 * What became of one thin event: the per-message results of everything the box actually
 * dispatched, plus a terminal code when it dispatched nothing.
 *
 * <p>This is a REPORT, not a work order. Every outcome it describes has already been written to
 * the ledger by the handler that produced it — the caller does not persist anything on the
 * strength of this object, and cannot, because only the handler knows which channel and which
 * recipient each row belonged to.
 */
@Data
@Builder
public class ThinEventResult {

    /**
     * One entry per v1 envelope the resolution stage minted and put through the dispatch
     * pipeline, in resolution order. Empty when the event resolved to nothing to send — which is
     * a normal outcome, not a failure.
     */
    @Builder.Default
    private List<DispatchResult> dispatches = Collections.emptyList();

    /**
     * The {@code NB_*} code of the channel-less decision, when the event produced no dispatch at
     * all: {@code NB_NO_ROUTING}, {@code NB_NO_RECIPIENTS}, {@code NB_RECIPIENT_LIMIT_EXCEEDED},
     * {@code NB_UNKNOWN_AUDIENCE_SCHEME}. Null when at least one message was dispatched.
     */
    private String terminalCode;

    /** Human-readable trace, in the same spirit as {@link DispatchResult#getDiagnostics()}. */
    @Builder.Default
    private List<String> diagnostics = Collections.emptyList();
}
