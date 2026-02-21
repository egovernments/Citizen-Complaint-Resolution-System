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

        ConfigEntryCreateRequest req = ConfigEntryCreateRequest.builder()
                .requestInfo(buildRequestInfo())
                .entry(ConfigEntry.builder()
                        .configCode("NOTIF_TEMPLATE_MAP")
                        .module("billing")
                        .eventType("BILL_GENERATED")
                        .channel("WHATSAPP")
                        .tenantId("pb.amritsar")
                        .locale("en_IN")
                        .value(value)
                        .build())
                .build();

        mockMvc.perform(post("/config/v1/entry/_create")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(req)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.entry.id", notNullValue()))
                .andExpect(jsonPath("$.entry.configCode", is("NOTIF_TEMPLATE_MAP")))
                .andExpect(jsonPath("$.entry.eventType", is("BILL_GENERATED")))
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

        ConfigEntryCreateRequest createReq = ConfigEntryCreateRequest.builder()
                .requestInfo(buildRequestInfo())
                .entry(ConfigEntry.builder()
                        .configCode("NOTIF_TEMPLATE_MAP")
                        .module("payments")
                        .eventType("PAYMENT_DONE")
                        .channel("WHATSAPP")
                        .tenantId("pb.jalandhar")
                        .locale("en_IN")
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
    void search_byEventTypeAndChannel() throws Exception {
        ObjectNode value = objectMapper.createObjectNode();
        value.put("template", "sms_water");

        ConfigEntryCreateRequest createReq = ConfigEntryCreateRequest.builder()
                .requestInfo(buildRequestInfo())
                .entry(ConfigEntry.builder()
                        .configCode("NOTIF_TEMPLATE_MAP")
                        .module("ws")
                        .eventType("WATER_BILL")
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
                        .eventType("WATER_BILL")
                        .channel("SMS")
                        .build())
                .build();

        mockMvc.perform(post("/config/v1/entry/_search")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(searchReq)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.entries", hasSize(greaterThanOrEqualTo(1))))
                .andExpect(jsonPath("$.entries[0].eventType", is("WATER_BILL")))
                .andExpect(jsonPath("$.entries[0].channel", is("SMS")));
    }

    // ==================== Update Tests ====================

    @Test
    void update_changesValueAndIncrementsRevision() throws Exception {
        ObjectNode originalValue = objectMapper.createObjectNode();
        originalValue.put("template", "licence_v1");

        ConfigEntryCreateRequest createReq = ConfigEntryCreateRequest.builder()
                .requestInfo(buildRequestInfo())
                .entry(ConfigEntry.builder()
                        .configCode("NOTIF_TEMPLATE_MAP")
                        .module("tl")
                        .eventType("LICENCE_ISSUED")
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

        ConfigEntryCreateRequest createReq = ConfigEntryCreateRequest.builder()
                .requestInfo(buildRequestInfo())
                .entry(ConfigEntry.builder()
                        .configCode("NOTIF_TEMPLATE_MAP")
                        .module("pt")
                        .eventType("PT_ASSESSMENT")
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
                        .configCode("NOTIF_TEMPLATE_MAP")
                        .module("ws")
                        .eventType("WS_BILL")
                        .channel("WHATSAPP")
                        .tenantId("pb.patiala")
                        .locale("en_IN")
                        .value(value)
                        .build())
                .build();

        mockMvc.perform(post("/config/v1/entry/_create")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(createReq)));

        ConfigResolveRequest resolveReq = ConfigResolveRequest.builder()
                .requestInfo(buildRequestInfo())
                .resolveRequest(ConfigResolveRequest.ResolveParams.builder()
                        .configCode("NOTIF_TEMPLATE_MAP")
                        .module("ws")
                        .tenantId("pb.patiala")
                        .locale("en_IN")
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
                        .configCode("NOTIF_TEMPLATE_MAP")
                        .module("tl")
                        .eventType("TL_RENEWAL")
                        .channel("WHATSAPP")
                        .tenantId("hr")
                        .locale("*")
                        .value(value)
                        .build())
                .build();

        mockMvc.perform(post("/config/v1/entry/_create")
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsString(createReq)));

        ConfigResolveRequest resolveReq = ConfigResolveRequest.builder()
                .requestInfo(buildRequestInfo())
                .resolveRequest(ConfigResolveRequest.ResolveParams.builder()
                        .configCode("NOTIF_TEMPLATE_MAP")
                        .module("tl")
                        .tenantId("hr.gurugram")
                        .locale("hi_IN")
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
