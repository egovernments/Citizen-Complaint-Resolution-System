package org.egov.config.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.egov.config.web.model.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import static org.hamcrest.Matchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
class ConfigControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    private RequestInfo buildRequestInfo() {
        return RequestInfo.builder()
                .apiId("config-service").ver("1.0").ts(System.currentTimeMillis()).msgId("test-msg")
                .userInfo(RequestInfo.UserInfo.builder().uuid("test-user").userName("testuser").build())
                .build();
    }

    // ==================== Create Tests ====================

    @Test
    void create_success() throws Exception {
        ObjectNode value = objectMapper.createObjectNode();
        value.put("templateId", "bill_tpl_001");
        value.put("workflowId", "whatsapp-bill");
        value.put("eventName", "BILL_GENERATED");

        ConfigEntryCreateRequest req = ConfigEntryCreateRequest.builder()
                .requestInfo(buildRequestInfo())
                .entry(ConfigEntry.builder()
                        .configCode("NOTIF_TEMPLATE_MAP")
                        .module("billing")
                        .channel("WHATSAPP")
                        .tenantId("pb.amritsar")
                        .value(value)
                        .build())
                .build();

        mockMvc.perform(post("/config/v1/entry/_create")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.entry.id", notNullValue()))
                .andExpect(jsonPath("$.entry.configCode", is("NOTIF_TEMPLATE_MAP")))
                .andExpect(jsonPath("$.entry.channel", is("WHATSAPP")))
                .andExpect(jsonPath("$.entry.revision", is(1)));
    }

    @Test
    void create_missingConfigCode_returns400() throws Exception {
        ObjectNode value = objectMapper.createObjectNode();
        value.put("result", "data");

        ConfigEntryCreateRequest req = ConfigEntryCreateRequest.builder()
                .requestInfo(buildRequestInfo())
                .entry(ConfigEntry.builder()
                        .tenantId("pb")
                        .value(value)
                        .build())
                .build();

        mockMvc.perform(post("/config/v1/entry/_create")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.Errors[0].code", is("INVALID_CONFIG_CODE")));
    }

    // ==================== Search Tests ====================

    @Test
    void search_byConfigCodeAndTenant() throws Exception {
        ObjectNode value = objectMapper.createObjectNode();
        value.put("template", "payment_tpl");
        value.put("eventName", "PAYMENT_DONE");

        ConfigEntryCreateRequest createReq = ConfigEntryCreateRequest.builder()
                .requestInfo(buildRequestInfo())
                .entry(ConfigEntry.builder()
                        .configCode("NOTIF_TEMPLATE_MAP")
                        .module("payments")
                        .channel("WHATSAPP")
                        .tenantId("pb.jalandhar")
                        .value(value)
                        .build())
                .build();

        mockMvc.perform(post("/config/v1/entry/_create")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(createReq)));

        ConfigEntrySearchRequest searchReq = ConfigEntrySearchRequest.builder()
                .requestInfo(buildRequestInfo())
                .criteria(ConfigEntrySearchCriteria.builder()
                        .configCode("NOTIF_TEMPLATE_MAP")
                        .tenantId("pb.jalandhar")
                        .build())
                .build();

        mockMvc.perform(post("/config/v1/entry/_search")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(searchReq)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.entries", hasSize(greaterThanOrEqualTo(1))))
                .andExpect(jsonPath("$.pagination.totalCount", greaterThanOrEqualTo(1)));
    }

    @Test
    void search_byModuleAndChannel() throws Exception {
        ObjectNode value = objectMapper.createObjectNode();
        value.put("template", "sms_water");

        ConfigEntryCreateRequest createReq = ConfigEntryCreateRequest.builder()
                .requestInfo(buildRequestInfo())
                .entry(ConfigEntry.builder()
                        .configCode("NOTIF_TEMPLATE_MAP")
                        .module("ws")
                        .channel("SMS")
                        .tenantId("pb.mohali")
                        .value(value)
                        .build())
                .build();

        mockMvc.perform(post("/config/v1/entry/_create")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(createReq)));

        ConfigEntrySearchRequest searchReq = ConfigEntrySearchRequest.builder()
                .requestInfo(buildRequestInfo())
                .criteria(ConfigEntrySearchCriteria.builder()
                        .module("ws")
                        .channel("SMS")
                        .tenantId("pb.mohali")
                        .build())
                .build();

        mockMvc.perform(post("/config/v1/entry/_search")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(searchReq)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.entries", hasSize(greaterThanOrEqualTo(1))))
                .andExpect(jsonPath("$.entries[0].channel", is("SMS")));
    }

    // ==================== Update Tests ====================

    @Test
    void update_changesValueAndIncrementsRevision() throws Exception {
        ObjectNode originalValue = objectMapper.createObjectNode();
        originalValue.put("template", "licence_v1");
        originalValue.put("eventName", "LICENCE_ISSUED");

        ConfigEntryCreateRequest createReq = ConfigEntryCreateRequest.builder()
                .requestInfo(buildRequestInfo())
                .entry(ConfigEntry.builder()
                        .configCode("NOTIF_TEMPLATE_MAP")
                        .module("tl")
                        .channel("WHATSAPP")
                        .tenantId("pb.ludhiana")
                        .value(originalValue)
                        .build())
                .build();

        String createResp = mockMvc.perform(post("/config/v1/entry/_create")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(createReq)))
                .andReturn().getResponse().getContentAsString();

        String entryId = objectMapper.readTree(createResp).at("/entry/id").asText();

        ObjectNode updatedValue = objectMapper.createObjectNode();
        updatedValue.put("template", "licence_v2");

        ConfigEntryUpdateRequest updateReq = ConfigEntryUpdateRequest.builder()
                .requestInfo(buildRequestInfo())
                .entry(ConfigEntry.builder()
                        .id(entryId)
                        .revision(1)
                        .value(updatedValue)
                        .build())
                .build();

        mockMvc.perform(post("/config/v1/entry/_update")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(updateReq)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.entry.revision", is(2)))
                .andExpect(jsonPath("$.entry.value.template", is("licence_v2")));
    }

    @Test
    void update_revisionMismatch_returns400() throws Exception {
        ObjectNode value = objectMapper.createObjectNode();
        value.put("template", "pt_v1");
        value.put("eventName", "PT_ASSESSMENT");

        ConfigEntryCreateRequest createReq = ConfigEntryCreateRequest.builder()
                .requestInfo(buildRequestInfo())
                .entry(ConfigEntry.builder()
                        .configCode("NOTIF_TEMPLATE_MAP")
                        .module("pt")
                        .channel("WHATSAPP")
                        .tenantId("pb.bathinda")
                        .value(value)
                        .build())
                .build();

        String createResp = mockMvc.perform(post("/config/v1/entry/_create")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(createReq)))
                .andReturn().getResponse().getContentAsString();

        String entryId = objectMapper.readTree(createResp).at("/entry/id").asText();

        ConfigEntryUpdateRequest updateReq = ConfigEntryUpdateRequest.builder()
                .requestInfo(buildRequestInfo())
                .entry(ConfigEntry.builder()
                        .id(entryId)
                        .revision(99)
                        .value(value)
                        .build())
                .build();

        mockMvc.perform(post("/config/v1/entry/_update")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(updateReq)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.Errors[0].code", is("REVISION_MISMATCH")));
    }

    // ==================== Resolve Tests ====================

    @Test
    void resolve_exactTenantMatch() throws Exception {
        ObjectNode value = objectMapper.createObjectNode();
        value.put("template", "ws_bill_tpl");

        ConfigEntryCreateRequest createReq = ConfigEntryCreateRequest.builder()
                .requestInfo(buildRequestInfo())
                .entry(ConfigEntry.builder()
                        .configCode("RESOLVE_TEST_EXACT")
                        .module("ws")
                        .channel("WHATSAPP")
                        .tenantId("pb.patiala")
                        .value(value)
                        .build())
                .build();

        mockMvc.perform(post("/config/v1/entry/_create")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(createReq)));

        ConfigResolveRequest resolveReq = ConfigResolveRequest.builder()
                .requestInfo(buildRequestInfo())
                .resolveRequest(ConfigResolveRequest.ResolveParams.builder()
                        .configCode("RESOLVE_TEST_EXACT")
                        .module("ws")
                        .tenantId("pb.patiala")
                        .build())
                .build();

        mockMvc.perform(post("/config/v1/entry/_resolve")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(resolveReq)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.resolved.entry.value.template", is("ws_bill_tpl")))
                .andExpect(jsonPath("$.resolved.resolutionMeta.matchedTenant", is("pb.patiala")));
    }

    @Test
    void resolve_tenantFallback() throws Exception {
        ObjectNode value = objectMapper.createObjectNode();
        value.put("template", "state_tl_tpl");

        ConfigEntryCreateRequest createReq = ConfigEntryCreateRequest.builder()
                .requestInfo(buildRequestInfo())
                .entry(ConfigEntry.builder()
                        .configCode("RESOLVE_TEST_FALLBACK")
                        .module("tl")
                        .channel("WHATSAPP")
                        .tenantId("hr")
                        .value(value)
                        .build())
                .build();

        mockMvc.perform(post("/config/v1/entry/_create")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(createReq)));

        ConfigResolveRequest resolveReq = ConfigResolveRequest.builder()
                .requestInfo(buildRequestInfo())
                .resolveRequest(ConfigResolveRequest.ResolveParams.builder()
                        .configCode("RESOLVE_TEST_FALLBACK")
                        .module("tl")
                        .tenantId("hr.gurugram")
                        .build())
                .build();

        mockMvc.perform(post("/config/v1/entry/_resolve")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(resolveReq)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.resolved.resolutionMeta.matchedTenant", is("hr")))
                .andExpect(jsonPath("$.resolved.entry.value.template", is("state_tl_tpl")));
    }

    @Test
    void resolve_notFound_returns400() throws Exception {
        ConfigResolveRequest resolveReq = ConfigResolveRequest.builder()
                .requestInfo(buildRequestInfo())
                .resolveRequest(ConfigResolveRequest.ResolveParams.builder()
                        .configCode("NONEXISTENT_CODE")
                        .tenantId("unknown")
                        .build())
                .build();

        mockMvc.perform(post("/config/v1/entry/_resolve")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(resolveReq)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.Errors[0].code", is("CONFIG_NOT_RESOLVED")));
    }
}
