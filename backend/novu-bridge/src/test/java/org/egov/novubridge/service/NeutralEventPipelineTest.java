package org.egov.novubridge.service;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.repository.DispatchLogRepository;
import org.egov.novubridge.service.delivery.DeliveryProviderRegistry;
import org.egov.novubridge.service.delivery.NovuDeliveryProvider;
import org.egov.novubridge.service.policy.ChannelPolicyClient;
import org.egov.novubridge.service.provider.ProviderAvailability;
import org.egov.novubridge.web.models.Contact;
import org.egov.novubridge.web.models.DispatchLogEntry;
import org.egov.novubridge.web.models.DispatchResult;
import org.egov.novubridge.web.models.NotificationEvent;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * The bridge is a module-neutral box. These tests prove it with a module that does not exist
 * in this repository: {@code XYZ}, carrying no complaint number, no {@code action}, no
 * {@code toState} — nothing PGR-shaped at all — and check it comes out the far end with a
 * sensible ledger row.
 *
 * <p>The companion half matters just as much: PGR's own event must be recorded EXACTLY as
 * before the neutral derivation existed, or the change would have quietly rewritten the
 * meaning of every row already in the table. Both are asserted here, side by side, so the
 * compatibility claim lives next to the thing that could break it.
 */
class NeutralEventPipelineTest {

    private NovuClient novuClient;
    private DispatchLogRepository dispatchLogRepository;
    private DispatchPipelineService service;

    @BeforeEach
    void setUp() {
        PreferenceServiceClient preferenceServiceClient = mock(PreferenceServiceClient.class);
        novuClient = mock(NovuClient.class);
        dispatchLogRepository = mock(DispatchLogRepository.class);

        NovuBridgeConfiguration config = new NovuBridgeConfiguration();
        config.setDefaultLocale("en_IN");
        config.setChannelsEnabled(List.of("SMS", "EMAIL"));
        // The onboarding step a new producer goes through: its eventType joins the allowlist.
        config.setEventTypes(List.of("COMPLAINTS_WORKFLOW_TRANSITIONED", "XYZ_LICENCE_RENEWED"));

        when(preferenceServiceClient.isChannelAllowed(anyString(), any(), any(), anyString())).thenReturn(true);
        when(novuClient.identifyThenTrigger(anyString(), any(), anyString(), anyString(), any(),
                anyString(), any(), any(), any()))
                .thenReturn(NovuClient.NovuResponse.builder().statusCode(201).response(Map.of("acknowledged", true)).build());

        ChannelPolicyClient policy = new ChannelPolicyClient(null, config);
        service = new DispatchPipelineService(new EnvelopeValidator(config), preferenceServiceClient,
                new DeliveryProviderRegistry(config, policy, new NovuDeliveryProvider(novuClient, config), null),
                policy, dispatchLogRepository, config, new ProviderAvailability(novuClient, config));
    }

    // ---- a module the bridge has never heard of ----------------------------

    @Test
    @DisplayName("an XYZ event with no complaint data flows through and is recorded SENT")
    void foreignModuleEventIsDelivered() {
        DispatchResult result = service.process(xyzEvent().build(), true, null);

        assertTrue(result.getNovuTriggered(), "a well-formed foreign event must be delivered");
        DispatchLogEntry row = singleRow();
        assertEquals("SENT", row.getStatus());
        assertEquals("XYZ", row.getModule(), "the producing module is recorded verbatim, never mapped");
        assertNull(row.getLastErrorCode());
    }

    @Test
    @DisplayName("its reference is its own entityId — no complaint field is consulted")
    void foreignModuleReferenceComesFromEntityId() {
        service.process(xyzEvent().build(), true, null);
        assertEquals("XYZ-LIC-2026-0042", singleRow().getReferenceNumber());
    }

    @Test
    @DisplayName("a producer that carries its reference in data.referenceNumber is understood too")
    void foreignModuleReferenceFallsBackToDataReferenceNumber() {
        Map<String, Object> data = new HashMap<>();
        data.put("referenceNumber", "XYZ-LIC-2026-0042");
        service.process(xyzEvent().entityId(null).data(data).build(), true, null);

        assertEquals("XYZ-LIC-2026-0042", singleRow().getReferenceNumber());
    }

    @Test
    @DisplayName("with no reference anywhere the row still addresses something: the eventId")
    void foreignModuleReferenceFallsBackToEventId() {
        service.process(xyzEvent().entityId(null).data(null).build(), true, null);
        assertEquals("evt-xyz-1", singleRow().getReferenceNumber());
    }

    @Test
    @DisplayName("with no action/toState vocabulary the template key is the eventName")
    void foreignModuleTemplateKeyFallsBackToEventName() {
        service.process(xyzEvent().templateKey(null).data(null).build(), true, null);
        assertEquals("XYZ.LICENCE.RENEWED", singleRow().getTemplateKey());
    }

    @Test
    @DisplayName("a typo'd channel is SKIPPED and visible, not dropped into the DLQ")
    void unknownChannelIsSkippedNotRejected() {
        // The other half of EnvelopeContractSchemaTest's documented divergence: the published
        // schema names three channels, the validator lets a fourth through, and THIS is why.
        service.process(xyzEvent().channel("PIGEON").build(), true, null);

        DispatchLogEntry row = singleRow();
        assertEquals("SKIPPED", row.getStatus());
        assertEquals("NB_UNSUPPORTED_CHANNEL", row.getLastErrorCode());
    }

    // ---- PGR must be untouched ---------------------------------------------

    @Test
    @DisplayName("a PGR event is recorded exactly as before: reference = entityId, key = templateKey")
    void pgrRowIsUnchanged() {
        service.process(pgrEvent().build(), true, null);

        DispatchLogEntry row = singleRow();
        assertEquals("SENT", row.getStatus());
        assertEquals("PGR-2026-000123", row.getReferenceNumber(), "PGR's reference is its entityId, as always");
        assertEquals("Complaints", row.getModule());
        assertEquals("CITIZEN.ASSIGN.PENDINGATLME.SMS.en_IN", row.getTemplateKey());
    }

    @Test
    @DisplayName("a PGR event with no templateKey still reconstructs the action/toState key")
    void pgrTemplateKeyReconstructionIsUnchanged() {
        service.process(pgrEvent().templateKey(null).build(), true, null);
        assertEquals("CITIZEN.ASSIGN.PENDINGATLME.SMS.en_IN", singleRow().getTemplateKey());
    }

    @Test
    @DisplayName("entityId still wins over data.complaintNo, so no existing row changes meaning")
    void entityIdOutranksComplaintNo() {
        // Both are present on every real PGR event and hold the same value; the ordering only
        // becomes visible if they ever disagree, and then the wire field must win.
        Map<String, Object> data = new HashMap<>();
        data.put("complaintNo", "SOMETHING-ELSE");
        service.process(pgrEvent().data(data).build(), true, null);

        assertEquals("PGR-2026-000123", singleRow().getReferenceNumber());
    }

    @Test
    @DisplayName("a PGR event that omits entityId falls back to its complaint number, not to nothing")
    void pgrWithoutEntityIdFallsBackToComplaintNo() {
        service.process(pgrEvent().entityId(null).build(), true, null);
        assertEquals("PGR-2026-000123", singleRow().getReferenceNumber());
    }

    // ---- fixtures ----------------------------------------------------------

    /** A licence renewal from a module that exists nowhere in this repository. */
    private static NotificationEvent.NotificationEventBuilder xyzEvent() {
        return NotificationEvent.builder()
                .schemaVersion("1")
                .eventId("evt-xyz-1")
                .eventType("XYZ_LICENCE_RENEWED")
                .eventName("XYZ.LICENCE.RENEWED")
                .producer("xyz-services")
                .module("XYZ")
                .entityType("LICENCE")
                .entityId("XYZ-LIC-2026-0042")
                .tenantId("ke.bomet")
                .channel("SMS")
                .subscriberId("ke.bomet:uuid-xyz")
                .contact(Contact.builder().userId("uuid-xyz").type("CITIZEN").name("Amina Otieno")
                        .phone("+254733111222").locale("en_IN").build())
                .renderedBody("Your licence XYZ-LIC-2026-0042 has been renewed until 31 Dec 2027.")
                .transactionId("XYZ-LIC-2026-0042:RENEWED:ke.bomet:uuid-xyz:SMS")
                .templateKey("XYZ.LICENCE.RENEWED.SMS.en_IN");
    }

    private static NotificationEvent.NotificationEventBuilder pgrEvent() {
        Map<String, Object> data = new HashMap<>();
        data.put("complaintNo", "PGR-2026-000123");
        data.put("status", "PENDINGATLME");
        data.put("action", "ASSIGN");
        data.put("toState", "PENDINGATLME");
        return NotificationEvent.builder()
                .schemaVersion("1")
                .eventId("evt-pgr-1")
                .eventType("COMPLAINTS_WORKFLOW_TRANSITIONED")
                .eventName("COMPLAINTS.WORKFLOW.ASSIGN")
                .producer("complaints-service")
                .module("Complaints")
                .entityType("COMPLAINT")
                .entityId("PGR-2026-000123")
                .tenantId("ke.bomet")
                .channel("SMS")
                .subscriberId("ke.bomet:uuid-123")
                .contact(Contact.builder().userId("uuid-123").type("CITIZEN").name("Jane Doe")
                        .phone("+254712345678").locale("en_IN").build())
                .renderedBody("Dear Jane, your complaint PGR-2026-000123 is assigned.")
                .transactionId("PGR-2026-000123:ASSIGN:PENDINGATLME:ke.bomet:uuid-123:SMS")
                .templateKey("CITIZEN.ASSIGN.PENDINGATLME.SMS.en_IN")
                .data(data);
    }

    private DispatchLogEntry singleRow() {
        ArgumentCaptor<DispatchLogEntry> captor = ArgumentCaptor.forClass(DispatchLogEntry.class);
        verify(dispatchLogRepository, times(1)).upsert(captor.capture());
        return captor.getValue();
    }
}
