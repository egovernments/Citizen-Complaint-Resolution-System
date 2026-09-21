package org.egov.novubridge.service.resolution;

import org.egov.common.contract.request.RequestInfo;
import org.egov.novubridge.web.models.ThinEvent;

/**
 * Everything a {@link RecipientResolver} may see. Deliberately narrow: the tenant, the event and
 * a request context to carry downstream. No MDMS, no Spring context, no repository — a resolver
 * that needed those would be doing routing's job.
 */
public final class ResolutionContext {

    private final String tenantId;
    private final ThinEvent event;
    private final RequestInfo requestInfo;

    public ResolutionContext(String tenantId, ThinEvent event, RequestInfo requestInfo) {
        this.tenantId = tenantId;
        this.event = event;
        this.requestInfo = requestInfo;
    }

    public String tenantId() {
        return tenantId;
    }

    public ThinEvent event() {
        return event;
    }

    /** Never null; the bridge stamps its own context because a thin event carries none. */
    public RequestInfo requestInfo() {
        return requestInfo;
    }
}
