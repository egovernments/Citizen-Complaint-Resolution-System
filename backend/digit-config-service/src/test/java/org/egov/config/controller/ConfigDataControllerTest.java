package org.egov.config.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import static org.hamcrest.Matchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
class ConfigDataControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    void createAndSearch() throws Exception {
        String createBody = """
                {
                  "RequestInfo": {},
                  "configData": {
                    "tenantId": "pg.citya",
                    "uniqueIdentifier": "COMPLAINTS.WORKFLOW.APPLY",
                    "data": {
                      "eventName": "COMPLAINTS.WORKFLOW.APPLY",
                      "templateId": "complaints-workflow-apply-42yz",
                      "contentSid": "HX158f8edc7079e2c2b76d9c8f68e87791",
                      "paramOrder": ["complaintNo", "complaintType"],
                      "requiredVars": ["complaintNo"]
                    }
                  }
                }
                """;

        mockMvc.perform(post("/config/v1/_create/TemplateBinding")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.configData[0].schemaCode").value("TemplateBinding"))
                .andExpect(jsonPath("$.configData[0].tenantId").value("pg.citya"))
                .andExpect(jsonPath("$.configData[0].id").isNotEmpty());

        // Search by schemaCode
        String searchBody = """
                {
                  "RequestInfo": {},
                  "criteria": {
                    "schemaCode": "TemplateBinding",
                    "tenantId": "pg.citya"
                  }
                }
                """;

        mockMvc.perform(post("/config/v1/_search")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(searchBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.configData", hasSize(1)))
                .andExpect(jsonPath("$.configData[0].data.eventName").value("COMPLAINTS.WORKFLOW.APPLY"))
                .andExpect(jsonPath("$.pagination.totalCount").value(1));
    }

    @Test
    void createAndUpdate() throws Exception {
        String createBody = """
                {
                  "RequestInfo": {},
                  "configData": {
                    "tenantId": "pg.citya",
                    "uniqueIdentifier": "novu.WHATSAPP",
                    "data": {
                      "providerName": "novu",
                      "channel": "WHATSAPP",
                      "novuApiKey": "test-key-123"
                    }
                  }
                }
                """;

        MvcResult createResult = mockMvc.perform(post("/config/v1/_create/ProviderDetail")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody))
                .andExpect(status().isCreated())
                .andReturn();

        JsonNode createResponse = objectMapper.readTree(createResult.getResponse().getContentAsString());
        String id = createResponse.at("/configData/0/id").asText();

        String updateBody = String.format("""
                {
                  "RequestInfo": {},
                  "configData": {
                    "id": "%s",
                    "data": {
                      "providerName": "novu",
                      "channel": "WHATSAPP",
                      "novuApiKey": "updated-key-456"
                    }
                  }
                }
                """, id);

        mockMvc.perform(post("/config/v1/_update/ProviderDetail")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(updateBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.configData[0].data.novuApiKey").value("updated-key-456"));
    }

    @Test
    void createDuplicate_shouldFail() throws Exception {
        String createBody = """
                {
                  "RequestInfo": {},
                  "configData": {
                    "tenantId": "pg.citya",
                    "uniqueIdentifier": "WHATSAPP_DUP",
                    "data": { "code": "WHATSAPP", "name": "WhatsApp" }
                  }
                }
                """;

        mockMvc.perform(post("/config/v1/_create/NotificationChannel")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody))
                .andExpect(status().isCreated());

        mockMvc.perform(post("/config/v1/_create/NotificationChannel")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createBody))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.Errors[0].code").value("DUPLICATE_RECORD"));
    }

    @Test
    void resolve_notFound() throws Exception {
        String resolveBody = """
                {
                  "RequestInfo": {},
                  "resolveRequest": {
                    "schemaCode": "TemplateBinding",
                    "tenantId": "pg.nonexistent"
                  }
                }
                """;

        mockMvc.perform(post("/config/v1/_resolve")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(resolveBody))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.Errors[0].code").value("CONFIG_NOT_RESOLVED"));
    }

    @Test
    void createMissingTenantId_shouldFail() throws Exception {
        String body = """
                {
                  "RequestInfo": {},
                  "configData": {
                    "uniqueIdentifier": "test",
                    "data": { "key": "value" }
                  }
                }
                """;

        mockMvc.perform(post("/config/v1/_create/TestSchema")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isBadRequest());
    }
}
