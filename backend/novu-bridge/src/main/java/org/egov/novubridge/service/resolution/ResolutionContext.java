package org.egov.novubridge.service.resolution;

import org.egov.common.contract.request.RequestInfo;
import org.egov.novubridge.web.models.ThinEvent;

/**
 * Everything a {@link RecipientResolver} may see: the event and a request context (never null;
 * the bridge stamps its own because a thin event carries none).
 */
public record ResolutionContext(ThinEvent event, RequestInfo requestInfo) {
}
