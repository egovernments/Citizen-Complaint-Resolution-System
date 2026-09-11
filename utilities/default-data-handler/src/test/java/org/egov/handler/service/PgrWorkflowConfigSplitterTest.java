package org.egov.handler.service;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.egov.handler.config.ServiceConfiguration;
import org.egov.handler.util.HrmsUtil;
import org.egov.handler.util.LocalizationUtil;
import org.egov.handler.util.MdmsBulkLoader;
import org.egov.handler.util.MdmsV2Util;
import org.egov.handler.util.TenantManagementUtil;
import org.egov.handler.util.WorkflowUtil;
import org.egov.handler.web.models.BusinessServiceRequest;
import org.egov.handler.web.models.Mdms;
import org.egov.handler.web.models.MdmsRequest;
import org.egov.tracer.kafka.CustomKafkaTemplate;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.DefaultResourceLoader;
import org.springframework.core.io.Resource;
import org.springframework.core.io.ResourceLoader;
import org.springframework.web.client.RestTemplate;

import java.io.IOException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Golden round-trip coverage for the PgrWorkflowConfig SPLITTER
 * ({@link DataHandlerService#createPgrWorkflowConfig(String)}).
 *
 * <p>The splitter (a) parses classpath {@code PgrWorkflowConfig.json}, (b) strips the authoring-only
 * {@code notifications}/{@code notificationTemplates} fields and POSTs the workflow via
 * {@code workflowUtil.createWfConfig}, then (c) emits one RAINMAKER-PGR.NotificationRouting row per
 * action-notification and one RAINMAKER-PGR.NotificationTemplate row per (template x body) via
 * {@code mdmsV2Util.createMdmsData}.
 *
 * <p>DDH-1 is the golden round-trip (RUNNABLE NOW). DDH-2 asserts the POST-FIX (W2) behavior: a
 * notification missing channel/audience, or an action missing nextState, is skipped+WARNed while the
 * workflow is still POSTed and the well-formed rows still emit — no exception escapes.
 *
 * <p>Harness notes:
 * <ul>
 *   <li>Service is constructed by hand per its 11-arg constructor. Every collaborator is a Mockito
 *       mock EXCEPT a real {@link ObjectMapper} and a real {@link ResourceLoader}.</li>
 *   <li>The ObjectMapper mirrors production ({@code MainConfiguration#objectMapper}) which
 *       <em>disables</em> {@code FAIL_ON_UNKNOWN_PROPERTIES}. This matters: the workflow contract
 *       ({@code org.egov.common.contract.workflow.Action}) has no {@code active} field and no
 *       {@code @JsonIgnoreProperties}, so a strict {@code new ObjectMapper()} would throw at the
 *       {@code treeToValue} call and no rows would ever emit. See the discrepancy note in the PR.</li>
 * </ul>
 */
class PgrWorkflowConfigSplitterTest {

    private static final String ROUTING_SCHEMA = "RAINMAKER-PGR.NotificationRouting";
    private static final String TEMPLATE_SCHEMA = "RAINMAKER-PGR.NotificationTemplate";
    private static final String TARGET_TENANT = "ke.testtenant";
    private static final String WORKFLOW_CLASSPATH = "classpath:PgrWorkflowConfig.json";

    private MdmsV2Util mdmsV2Util;
    private HrmsUtil hrmsUtil;
    private LocalizationUtil localizationUtil;
    private TenantManagementUtil tenantManagementUtil;
    private ServiceConfiguration serviceConfig;
    private WorkflowUtil workflowUtil;
    private CustomKafkaTemplate producer;
    private MdmsBulkLoader mdmsBulkLoader;
    private RestTemplate restTemplate;

    // Real collaborators — mirror production wiring.
    private ObjectMapper objectMapper;

    @BeforeEach
    void setUp() {
        mdmsV2Util = mock(MdmsV2Util.class);
        hrmsUtil = mock(HrmsUtil.class);
        localizationUtil = mock(LocalizationUtil.class);
        tenantManagementUtil = mock(TenantManagementUtil.class);
        serviceConfig = mock(ServiceConfiguration.class);
        workflowUtil = mock(WorkflowUtil.class);
        producer = mock(CustomKafkaTemplate.class);
        mdmsBulkLoader = mock(MdmsBulkLoader.class);
        restTemplate = mock(RestTemplate.class);

        // MainConfiguration#objectMapper: FAIL_ON_UNKNOWN_PROPERTIES disabled (production parity).
        objectMapper = new ObjectMapper().disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
    }

    private DataHandlerService buildService(ResourceLoader resourceLoader) {
        return new DataHandlerService(mdmsV2Util, hrmsUtil, localizationUtil, tenantManagementUtil,
                serviceConfig, objectMapper, resourceLoader, workflowUtil, producer, mdmsBulkLoader,
                restTemplate);
    }

    /** Real resource loader: {@code classpath:PgrWorkflowConfig.json} resolves from src/main/resources. */
    private DataHandlerService serviceWithRealConfig() {
        return buildService(new DefaultResourceLoader());
    }

    // ---------------------------------------------------------------------------------------------
    // DDH-1 — Splitter golden round-trip (RUNNABLE NOW)
    // ---------------------------------------------------------------------------------------------

    @Test
    void strippedWorkflow_hasNoNotificationResidue_atAnyDepth() {
        serviceWithRealConfig().createPgrWorkflowConfig(TARGET_TENANT);

        ArgumentCaptor<BusinessServiceRequest> wfCaptor = ArgumentCaptor.forClass(BusinessServiceRequest.class);
        verify(workflowUtil, times(1)).createWfConfig(wfCaptor.capture());
        BusinessServiceRequest posted = wfCaptor.getValue();

        assertNotNull(posted.getBusinessServices());
        assertFalse(posted.getBusinessServices().isEmpty(), "expected at least one BusinessService POSTed");
        // tenantId is rewritten to the target tenant (DataHandlerService line 565).
        posted.getBusinessServices().forEach(bs ->
                assertEquals(TARGET_TENANT, bs.getTenantId(), "BusinessService.tenantId must be the target tenant"));

        // Serialize the POSTed object back to a tree and assert the authoring-only fields are gone at
        // ANY depth. NOTE: with FAIL_ON_UNKNOWN disabled the workflow contract simply can't hold these
        // fields, so this pins the OUTPUT contract (what is POSTed to egov-workflow is clean) rather
        // than relying on treeToValue throwing. That is the property the workflow service depends on.
        JsonNode tree = objectMapper.valueToTree(posted);
        assertNoFieldAnywhere(tree, "notifications");
        assertNoFieldAnywhere(tree, "notificationTemplates");
    }

    @Test
    void emittedRoutingRows_matchGoldenUids_andRowShape() {
        serviceWithRealConfig().createPgrWorkflowConfig(TARGET_TENANT);

        List<MdmsRequest> emitted = captureMdmsCreates(22);
        List<Mdms> routing = filterBySchema(emitted, ROUTING_SCHEMA);

        assertEquals(11, routing.size(), "expected exactly 11 NotificationRouting rows");
        assertEquals(goldenSet("/notification/golden-routing-uids.json"),
                uidSet(routing), "routing uniqueIdentifier set must match golden");

        Mdms gro = findByUid(routing, "PGR.APPLY.PENDINGFORASSIGNMENT.GRO.SMS");
        assertEquals(TARGET_TENANT, gro.getTenantId());
        JsonNode data = gro.getData();
        assertEquals("PGR", data.path("businessService").asText());
        assertEquals("APPLY", data.path("action").asText());
        assertEquals("PENDINGFORASSIGNMENT", data.path("toState").asText());
        assertEquals("GRO", data.path("audience").asText());
        assertEquals("SMS", data.path("channel").asText());
        assertFalse(data.path("assigneeOnly").asBoolean(true), "assigneeOnly should be false");
        assertTrue(data.path("active").asBoolean(false), "active should be true");
        assertTrue(data.get("fromState").isNull(), "fromState should be an explicit null node");
    }

    @Test
    void emittedTemplateRows_matchGoldenUids_andCarryBodies() {
        serviceWithRealConfig().createPgrWorkflowConfig(TARGET_TENANT);

        List<MdmsRequest> emitted = captureMdmsCreates(22);
        List<Mdms> templates = filterBySchema(emitted, TEMPLATE_SCHEMA);

        assertEquals(11, templates.size(), "expected exactly 11 NotificationTemplate rows");
        assertEquals(goldenSet("/notification/golden-template-uids.json"),
                uidSet(templates), "template uniqueIdentifier set must match golden");

        Mdms citizenSms = findByUid(templates, "CITIZEN.APPLY.PENDINGFORASSIGNMENT.SMS.en_IN");
        assertEquals(TARGET_TENANT, citizenSms.getTenantId());
        JsonNode data = citizenSms.getData();
        assertTrue(data.path("body").asText().trim().length() > 0, "body must be non-blank");
        assertEquals("en_IN", data.path("locale").asText());
        assertTrue(data.path("active").asBoolean(false), "active should be true");
        assertTrue(data.get("placeholders").isArray(), "placeholders must be an array node");
    }

    @Test
    void rerun_isIdempotent_emitsIdenticalPayloads() {
        DataHandlerService service = serviceWithRealConfig();

        // Two full passes must not throw. True duplicate tolerance (swallowing DUPLICATE_RECORD /
        // MDMS phantom-200) lives inside the real MdmsV2Util and is out of unit scope here; this test
        // only pins that the splitter emits the SAME payloads deterministically on every run.
        assertDoesNotThrow(() -> {
            service.createPgrWorkflowConfig(TARGET_TENANT);
            service.createPgrWorkflowConfig(TARGET_TENANT);
        });

        List<MdmsRequest> emitted = captureMdmsCreates(44);
        List<String> firstPass = keyStrings(emitted.subList(0, 22));
        List<String> secondPass = keyStrings(emitted.subList(22, 44));

        // Multiset equality of (schemaCode, uniqueIdentifier) across the two passes.
        assertEquals(sorted(firstPass), sorted(secondPass),
                "second pass must emit an identical multiset of (schema, uid) rows");
    }

    @Test
    void workflowPostedBeforeMdmsEmission() {
        serviceWithRealConfig().createPgrWorkflowConfig(TARGET_TENANT);

        // Documented ordering: strip+POST workflow first, THEN emit MDMS rows.
        // atLeastOnce() asserts the ordering relationship without pinning the (22) emission count.
        InOrder inOrder = org.mockito.Mockito.inOrder(workflowUtil, mdmsV2Util);
        inOrder.verify(workflowUtil).createWfConfig(any(BusinessServiceRequest.class));
        inOrder.verify(mdmsV2Util, org.mockito.Mockito.atLeastOnce()).createMdmsData(any(MdmsRequest.class));
    }

    // ---------------------------------------------------------------------------------------------
    // DDH-2 — Malformed authoring row is skipped, not fatal (POST-FIX / W2 behavior)
    // ---------------------------------------------------------------------------------------------

    @Test
    void malformedNotification_missingChannel_isSkipped_othersEmitted() throws IOException {
        // Feed a doctored config: one notification lacks `channel`, one action lacks `nextState`
        // (carrying a notification), and one template body lacks `channel`. Post-W2 each is skipped
        // with a WARN; nothing throws.
        ResourceLoader stub = mock(ResourceLoader.class);
        Resource malformed = new ClassPathResource("PgrWorkflowConfig-malformed.json");
        assertTrue(malformed.exists(), "test fixture PgrWorkflowConfig-malformed.json must be on the classpath");
        when(stub.getResource(eq(WORKFLOW_CLASSPATH))).thenReturn(malformed);

        DataHandlerService service = buildService(stub);

        assertDoesNotThrow(() -> service.createPgrWorkflowConfig(TARGET_TENANT),
                "a malformed authoring row must be skipped, never fatal");

        // The workflow is still POSTed despite the malformed notification rows.
        verify(workflowUtil, times(1)).createWfConfig(any(BusinessServiceRequest.class));

        // Only the two well-formed rows emit: the CITIZEN/SMS routing row and its SMS template.
        // (GRO-missing-channel notification, ASSIGN-missing-nextState notification, and the
        //  GRO template body missing channel are all skipped.)
        ArgumentCaptor<MdmsRequest> cap = ArgumentCaptor.forClass(MdmsRequest.class);
        verify(mdmsV2Util, times(2)).createMdmsData(cap.capture());

        List<Mdms> emitted = cap.getAllValues().stream().map(MdmsRequest::getMdms).collect(Collectors.toList());
        Set<String> uids = emitted.stream().map(Mdms::getUniqueIdentifier).collect(Collectors.toSet());

        assertTrue(uids.contains("PGR.APPLY.PENDINGFORASSIGNMENT.CITIZEN.SMS"),
                "well-formed routing row must still emit");
        assertTrue(uids.contains("CITIZEN.APPLY.PENDINGFORASSIGNMENT.SMS.en_IN"),
                "well-formed template row must still emit");
        assertFalse(uids.stream().anyMatch(u -> u.contains("GRO")),
                "GRO routing/template rows are malformed and must be skipped");
        assertFalse(uids.stream().anyMatch(u -> u.contains("PGR_LME")),
                "ASSIGN action missing nextState → PGR_LME routing row must be skipped");
    }

    // ---------------------------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------------------------

    private List<MdmsRequest> captureMdmsCreates(int expectedCalls) {
        ArgumentCaptor<MdmsRequest> cap = ArgumentCaptor.forClass(MdmsRequest.class);
        verify(mdmsV2Util, times(expectedCalls)).createMdmsData(cap.capture());
        return cap.getAllValues();
    }

    private static List<Mdms> filterBySchema(List<MdmsRequest> requests, String schemaCode) {
        return requests.stream()
                .map(MdmsRequest::getMdms)
                .filter(m -> schemaCode.equals(m.getSchemaCode()))
                .collect(Collectors.toList());
    }

    private static Set<String> uidSet(List<Mdms> rows) {
        return rows.stream().map(Mdms::getUniqueIdentifier).collect(Collectors.toSet());
    }

    private static Mdms findByUid(List<Mdms> rows, String uid) {
        return rows.stream()
                .filter(m -> uid.equals(m.getUniqueIdentifier()))
                .findFirst()
                .orElseThrow(() -> new AssertionError("expected emitted row with uid " + uid));
    }

    private static List<String> keyStrings(List<MdmsRequest> requests) {
        return requests.stream()
                .map(r -> r.getMdms().getSchemaCode() + "|" + r.getMdms().getUniqueIdentifier())
                .collect(Collectors.toList());
    }

    private static List<String> sorted(List<String> in) {
        List<String> copy = new ArrayList<>(in);
        copy.sort(String::compareTo);
        return copy;
    }

    private Set<String> goldenSet(String classpathResource) {
        try {
            JsonNode arr = objectMapper.readTree(getClass().getResourceAsStream(classpathResource));
            Set<String> out = new HashSet<>();
            arr.forEach(n -> out.add(n.asText()));
            return out;
        } catch (IOException e) {
            throw new AssertionError("could not read golden fixture " + classpathResource, e);
        }
    }

    private static void assertNoFieldAnywhere(JsonNode node, String field) {
        if (node == null) {
            return;
        }
        if (node.isObject()) {
            assertFalse(node.has(field),
                    "forbidden field '" + field + "' present in POSTed workflow payload");
            node.fields().forEachRemaining(e -> assertNoFieldAnywhere(e.getValue(), field));
        } else if (node.isArray()) {
            node.forEach(child -> assertNoFieldAnywhere(child, field));
        }
    }
}
