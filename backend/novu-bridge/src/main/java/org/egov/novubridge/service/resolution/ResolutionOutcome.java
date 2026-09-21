package org.egov.novubridge.service.resolution;

import org.egov.novubridge.web.models.DispatchResult;
import org.egov.novubridge.web.models.NotificationEvent;

import java.util.ArrayList;
import java.util.List;

/**
 * Everything one thin event resolved to: the v1 envelopes that were minted, what the dispatch
 * pipeline made of each, the channel-less decision code when there was one, and a readable trace.
 *
 * <p>The same object serves the Kafka path and {@code POST /dispatch/_resolve}. On the dry-run
 * path the envelopes are the whole answer and no row was written; on the live path they are what
 * was handed to the pipeline, which wrote the rows itself.
 */
public final class ResolutionOutcome {

    private final List<NotificationEvent> envelopes = new ArrayList<>();
    private final List<DispatchResult> dispatches = new ArrayList<>();
    private final List<String> diagnostics = new ArrayList<>();
    private String terminalCode;

    /** In emission order: routing-row order, then recipient order within each row. */
    public List<NotificationEvent> getEnvelopes() {
        return envelopes;
    }

    public List<DispatchResult> getDispatches() {
        return dispatches;
    }

    public List<String> getDiagnostics() {
        return diagnostics;
    }

    /**
     * The {@code NB_*} code of the channel-less decision, when the box decided something before
     * there was a channel to decide it on. Null when routing, recipients and templates all
     * resolved.
     */
    public String getTerminalCode() {
        return terminalCode;
    }

    void setTerminalCode(String terminalCode) {
        this.terminalCode = terminalCode;
    }

    void diagnose(String message) {
        diagnostics.add(message);
    }
}
