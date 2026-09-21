package org.egov.novubridge.web.models;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.egov.common.contract.response.ResponseInfo;

import java.util.List;

/**
 * What {@code POST /dispatch/_resolve} answers: the envelopes the box WOULD mint for a thin event,
 * and the reasoning that produced them.
 *
 * <p>Nothing was sent and no ledger row was written, which is what makes the endpoint safe to
 * point at a production tenant with real config. It is the answer to "why did this event send
 * nothing", asked before the event happens rather than after.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ThinEventResolveResponse {

    private ResponseInfo responseInfo;

    /** One per recipient x channel, in emission order. Empty when the box would send nothing. */
    private List<NotificationEvent> envelopes;

    /** The channel-less decision code when there would be none, e.g. {@code NB_NO_ROUTING}. */
    private String terminalCode;

    /** Every decision the resolver took, in order, including the ones that skipped a recipient. */
    private List<String> diagnostics;
}
