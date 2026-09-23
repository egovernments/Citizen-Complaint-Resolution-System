package org.egov.novubridge.service.resolution;

import org.egov.novubridge.web.models.DispatchResult;
import org.egov.novubridge.web.models.NotificationEvent;

import java.util.ArrayList;
import java.util.List;

/** What one thin event resolved to; shared by the Kafka path and the dry-run {@code _resolve}. */
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

    /** The NB_* code of a decision taken before there was a channel; null when none was. */
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
