package org.egov.pgr.onboarding;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.*;
import java.util.*;
import static org.junit.Assert.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

/**
 * Field finding (dev deployment, 2026-10-07): a self-serve workspace got NO notification schemas, rows,
 * channel decisions or access-control rows, and the deploy could not seed it later (no ADMIN there, and
 * the founder signs in through Keycloak only). Provisioning now seeds the same defaults the deploy does.
 */
public class NotificationDefaultsStepTest {
    private final ObjectMapper mapper = new ObjectMapper();
    private OnboardingProvisionerClient client;
    private NotificationDefaults defaults;
    private OnboardingSteps steps;
    private OnboardingSignup signup;
    private OnboardingOperation op;
    private OnboardingProgress progress;
    /** tenant|schema -> rows (MDMS wrapper with data). */
    private final Map<String, List<JsonNode>> mdms = new LinkedHashMap<>();
    private final Set<String> schemas = new HashSet<>();
    private final List<String> writes = new ArrayList<>();
    private OnboardingFailure failOn;
    private String failSchema;

    @Before @SuppressWarnings("unchecked")
    public void setup() throws Exception {
        client = mock(OnboardingProvisionerClient.class);
        when(client.mdmsSchemaSearchPath()).thenReturn("/egov-mdms-service/schema/v1/_search");
        when(client.mdmsSearchPath()).thenReturn("/egov-mdms-service/v2/_search");
        defaults = new NotificationDefaults(mapper);
        steps = new OnboardingSteps(client, new PlatformBaseline(mapper), mapper);
        signup = OnboardingSignup.builder().id(UUID.randomUUID()).requestedTenantId("newtown").build();
        op = OnboardingOperation.builder().id(UUID.randomUUID()).signupId(signup.getId()).build();
        OnboardingRepository repository = mock(OnboardingRepository.class);
        when(repository.checkpoint(any(), any(), anyLong())).thenReturn(true);
        progress = new OnboardingProgress(repository, op, UUID.randomUUID());
        when(client.read(anyString(), anyString(), anyMap())).thenAnswer(call -> {
            String path = call.getArgument(1); Map<String, Object> body = call.getArgument(2);
            if (path.contains("schema/v1/_search")) {
                String code = ((List<String>) ((Map<String, Object>) body.get("SchemaDefCriteria")).get("codes")).get(0);
                return mapper.valueToTree(Map.of("SchemaDefinitions", schemas.contains(code) ? List.of(Map.of("code", code)) : List.of()));
            }
            Map<String, Object> criteria = (Map<String, Object>) body.get("MdmsCriteria");
            List<JsonNode> rows = mdms.getOrDefault(criteria.get("tenantId") + "|" + criteria.get("schemaCode"), List.of());
            int offset = (Integer) criteria.get("offset"), limit = (Integer) criteria.get("limit");
            return mapper.valueToTree(Map.of("mdms", rows.subList(Math.min(offset, rows.size()), Math.min(offset + limit, rows.size()))));
        });
        when(client.write(any(), anyString(), anyString(), anyMap())).thenAnswer(call -> {
            OnboardingProgress.WriteScope scope = call.getArgument(0);
            assertEquals(NotificationDefaultsStep.STEP, scope.step());
            String path = call.getArgument(2); Map<String, Object> body = call.getArgument(3);
            if (path.contains("schema/v1/_create")) {
                String code = (String) ((Map<String, Object>) body.get("SchemaDefinition")).get("code");
                schemas.add(code); writes.add("schema:" + code);
                return mapper.createObjectNode();
            }
            assertTrue("a create, never an update: " + path, path.startsWith("/egov-mdms-service/v2/_create/"));
            JsonNode row = mapper.valueToTree(body.get("Mdms"));
            String schema = row.path("schemaCode").asText();
            assertTrue("only the packaged seed rows, verbatim: " + row, defaults.isSeedRecord(schema, row.path("data"), "newtown"));
            if (schema.equals(failSchema)) throw failOn;
            mdms.computeIfAbsent("newtown|" + schema, k -> new ArrayList<>()).add(row);
            writes.add(schema);
            return mapper.createObjectNode();
        });
    }

    private NotificationDefaultsStep step(boolean enabled) {
        NotificationDefaultsStep step = new NotificationDefaultsStep(defaults, client, mapper, enabled);
        steps.setNotificationDefaults(step);
        return step;
    }

    private long count(String schema) { return writes.stream().filter(schema::equals).count(); }

    @Test public void aNewWorkspaceGetsTheDeploysDefaults_routingLast() {
        step(true);
        steps.perform(NotificationDefaultsStep.STEP, signup, op, progress);

        assertEquals(9, writes.stream().filter(w -> w.startsWith("schema:")).count());
        assertEquals(17, count("ACCESSCONTROL-ACTIONS-TEST.actions-test"));
        assertEquals(57, count("ACCESSCONTROL-ROLEACTIONS.roleactions"));
        assertEquals(14, count("NOTIFICATIONS.EventCatalogue"));
        assertEquals(42, count("NOTIFICATIONS.Template"));
        assertEquals(14, count("NOTIFICATIONS.ProviderTemplate"));
        assertEquals(24, count("NOTIFICATIONS.Routing"));
        assertEquals("no channel rows: the deployment's channel allowlist applies", 0,
                count("NOTIFICATIONS.Channel") + count("RAINMAKER-PGR.NotificationChannel"));
        int firstRouting = writes.indexOf("NOTIFICATIONS.Routing");
        for (String before : List.of("NOTIFICATIONS.EventCatalogue", "NOTIFICATIONS.Template", "NOTIFICATIONS.ProviderTemplate"))
            assertTrue(before + " lands before any routing row", writes.lastIndexOf(before) < firstRouting);
        assertTrue("actions before the role-actions that reference them",
                writes.lastIndexOf("ACCESSCONTROL-ACTIONS-TEST.actions-test") < writes.indexOf("ACCESSCONTROL-ROLEACTIONS.roleactions"));
        JsonNode roleAction = mdms.get("newtown|ACCESSCONTROL-ROLEACTIONS.roleactions").get(0).path("data");
        assertEquals("newtown", roleAction.path("tenantId").asText());
    }

    @Test public void aSecondRunWritesNothing() {
        step(true);
        steps.perform(NotificationDefaultsStep.STEP, signup, op, progress);
        int first = writes.size();
        op.getRecordProgress().clear(); // a fresh operation: only MDMS says what exists
        steps.perform(NotificationDefaultsStep.STEP, signup, op, progress);
        assertEquals(first, writes.size());
    }

    @Test public void aTenantWithItsOwnRoutingKeepsItsConfiguration_butGetsTheAccessRows() {
        mdms.put("newtown|NOTIFICATIONS.Routing", new ArrayList<>(List.of(mapper.valueToTree(Map.of("isActive", true,
                "data", Map.of("module", "Complaints", "eventName", "COMPLAINTS.WORKFLOW.APPLY.PENDINGFORASSIGNMENT",
                        "audience", "ROLE:GRO", "channel", "SMS", "active", true))))));
        step(true);
        steps.perform(NotificationDefaultsStep.STEP, signup, op, progress);
        assertEquals(57, count("ACCESSCONTROL-ROLEACTIONS.roleactions"));
        assertEquals(0, count("NOTIFICATIONS.Template") + count("NOTIFICATIONS.Routing") + count("NOTIFICATIONS.EventCatalogue"));
    }

    @Test public void aFailureNeverFailsTheSignup_andHoldsRoutingBack() {
        failSchema = "NOTIFICATIONS.Template"; failOn = new OnboardingFailure("MDMS_SCHEMA_VALIDATION_FAILED", false, 400);
        step(true);
        steps.perform(NotificationDefaultsStep.STEP, signup, op, progress);   // no exception
        assertEquals(0, count("NOTIFICATIONS.Routing"));
        assertEquals("DONE", op.getRecordProgress().get("notifications:skipped:MDMS_SCHEMA_VALIDATION_FAILED"));
    }

    @Test public void aLostLeaseStillStopsTheRun() {
        failSchema = "NOTIFICATIONS.Template"; failOn = new OnboardingFailure("ONBOARDING_LEASE_LOST", true);
        step(true);
        assertEquals("ONBOARDING_LEASE_LOST", assertThrows(OnboardingFailure.class,
                () -> steps.perform(NotificationDefaultsStep.STEP, signup, op, progress)).getCode());
    }

    @Test public void switchedOffItTouchesNothing() {
        step(false);
        steps.perform(NotificationDefaultsStep.STEP, signup, op, progress);
        assertEquals(List.of(), writes);
        verify(client, never()).read(anyString(), anyString(), anyMap());
    }

    @Test public void itRunsRightAfterThePlatformBaseline_beforeTheFounderCanSignIn() {
        List<String> order = OnboardingRunner.STEPS;
        assertEquals(order.indexOf("PLATFORM_BASELINE") + 1, order.indexOf(NotificationDefaultsStep.STEP));
        assertTrue(order.indexOf(NotificationDefaultsStep.STEP) < order.indexOf("FOUNDER_HRMS"));
    }
}
