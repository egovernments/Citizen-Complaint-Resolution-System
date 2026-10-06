package org.egov.pgr.web.controllers;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.contract.response.ResponseInfo;
import org.egov.pgr.service.EmployeeContextService;
import org.egov.pgr.util.ResponseInfoFactory;
import org.egov.pgr.web.models.EmployeeContextResponse;
import org.egov.pgr.web.models.EmployeeWorkingContext;
import org.egov.pgr.web.models.RequestInfoWrapper;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class EmployeeContextControllerTest {

    @Test
    void returnsDigitResponseEnvelopeWithWorkingContext() {
        EmployeeContextService service = mock(EmployeeContextService.class);
        ResponseInfoFactory responseInfoFactory = mock(ResponseInfoFactory.class);
        EmployeeContextController controller = new EmployeeContextController(service, responseInfoFactory);
        RequestInfo requestInfo = RequestInfo.builder().apiId("Rainmaker").build();
        EmployeeWorkingContext context = EmployeeWorkingContext.builder()
                .available(true)
                .tenantId("ke.bomet")
                .build();
        ResponseInfo responseInfo = ResponseInfo.builder().status("successful").build();
        when(service.getContext(requestInfo, "ke.bomet")).thenReturn(context);
        when(responseInfoFactory.createResponseInfoFromRequestInfo(requestInfo, true)).thenReturn(responseInfo);

        EmployeeContextResponse response = controller.context(
                RequestInfoWrapper.builder().requestInfo(requestInfo).build(), "ke.bomet").getBody();

        assertSame(context, response.getWorkingContext());
        assertSame(responseInfo, response.getResponseInfo());
        JsonNode json = new ObjectMapper().valueToTree(response);
        assertEquals("ke.bomet", json.path("WorkingContext").path("tenantId").asText());
        assertEquals("successful", json.path("ResponseInfo").path("status").asText());
    }
}
