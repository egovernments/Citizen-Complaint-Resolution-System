package org.egov.novubridge.web.models;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DerivedContext {
    private String channel;
    private String audience;
    private String workflowState;
    private String locale;
    private String recipientMobile;
    private String recipientUserId;

    // ---- Config-driven pass-through fields (carried from the event) ----
    private String subscriberId;
    private String renderedBody;
    private String renderedSubject;
    private String email;
    private String name;
    private String transactionId;

    /**
     * Which inbound kind produced the envelope being dispatched:
     * {@link DispatchLogEntry#SOURCE_PATH_RESOLVED} when the resolution stage minted it, null
     * when a producer sent it pre-rendered (the repository writes {@code PRERENDERED} for null,
     * so the column is never ambiguous). Carried here rather than threaded through a dozen
     * persist calls, because this object is already the one thing every one of them holds.
     */
    private String sourcePath;
}
