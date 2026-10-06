package org.egov.novubridge.web.models;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;
import org.egov.common.contract.response.ResponseInfo;

import java.util.List;

/**
 * {@code POST /dispatch/_resolve}: the envelopes the box WOULD mint for a thin event, and why.
 * Nothing is sent and no ledger row is written.
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
