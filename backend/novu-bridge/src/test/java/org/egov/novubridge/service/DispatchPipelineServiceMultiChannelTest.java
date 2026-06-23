package org.egov.novubridge.service;

import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.repository.DispatchLogRepository;
import org.egov.novubridge.web.models.ComplaintsDomainEvent;
import org.egov.novubridge.web.models.DispatchResult;
import org.egov.novubridge.web.models.ResolvedProvider;
import org.egov.novubridge.web.models.ResolvedTemplate;
import org.egov.novubridge.web.models.Stakeholder;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mock;
import org.mockito.MockitoAnnotations;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * Multi-channel dispatch behaviour ({@link DispatchPipelineService#processEnabledChannels}):
 * per-channel isolation, the global allow-list guard, and the default-off outcome.
 */
public class DispatchPipelineServiceMultiChannelTest {

    @Mock private EnvelopeValidator envelopeValidator;
    @Mock private PreferenceServiceClient preferenceServiceClient;
    @Mock private UserServiceClient userServiceClient;
    @Mock private ConfigServiceClient configServiceClient;
    @Mock private NovuClient novuClient;
    @Mock private DispatchLogRepository dispatchLogRepository;
    @Mock private MdmsServiceClient mdmsServiceClient;

    private NovuBridgeConfiguration config;
    private DispatchPipelineService service;

    @BeforeEach
    void setUp() {
        MockitoAnnotations.openMocks(this);
        config = new NovuBridgeConfiguration();
        config.setChannel("whatsapp,sms");     // both channels globally allowed by default
        config.setDefaultLocale("en_IN");
        service = new DispatchPipelineService(envelopeValidator, preferenceServiceClient, userServiceClient,
                configServiceClient, novuClient, dispatchLogRepository, config, mdmsServiceClient);
    }

    private ComplaintsDomainEvent event() {
        return ComplaintsDomainEvent.builder()
                .eventId("evt-1").eventName("complaint-resolved").tenantId("pb.amritsar").module("PGR")
                // mobile is already E.164 so formatRecipientPhone needs no MDMS lookup
                .stakeholders(List.of(Stakeholder.builder().type("CITIZEN").userId("u1").mobile("+254700000000").build()))
                .data(Map.of("complaintNo", "PGR-1"))
                .build();
    }

    private void stubHappyRecipient() {
        when(userServiceClient.resolveUserUuid(any(), any(), any(), any())).thenReturn("uuid-1");
        when(preferenceServiceClient.getUserPreferredLocale(any(), any(), any())).thenReturn("en_IN");
        when(preferenceServiceClient.isChannelAllowed(any(), any(), any(), any())).thenReturn(true);
        when(configServiceClient.resolveTemplate(any(), any(), any(), any()))
                .thenReturn(ResolvedTemplate.builder().templateKey("tk").build());
    }

    @Test
    void oneChannelFailing_doesNotBlockTheOther() {
        when(configServiceClient.getEnabledChannels("pb.amritsar")).thenReturn(List.of("whatsapp", "sms"));
        stubHappyRecipient();

        // whatsapp has a provider; sms has none -> NB_NO_ACTIVE_PROVIDER, caught per channel
        when(configServiceClient.resolveProvidersByChannel("pb.amritsar", "whatsapp"))
                .thenReturn(List.of(ResolvedProvider.builder().providerName("twilio").channel("whatsapp").build()));
        when(configServiceClient.resolveProvidersByChannel("pb.amritsar", "sms"))
                .thenReturn(List.of());
        when(novuClient.triggerWithProviderConfig(any(), any(), any(), any(), any(), any(), any(), any(), any()))
                .thenReturn(NovuClient.NovuResponse.builder().statusCode(201).response(Map.of("ok", true)).build());

        List<DispatchResult> results = service.processEnabledChannels(event(), true, null);

        assertEquals(2, results.size());
        DispatchResult whatsapp = results.get(0);
        DispatchResult sms = results.get(1);
        assertEquals(Boolean.TRUE, whatsapp.getNovuTriggered(), "whatsapp should have dispatched");
        assertEquals(Boolean.FALSE, sms.getNovuTriggered(), "sms should not have dispatched");
        assertEquals(Boolean.FALSE, sms.getValid(), "sms should be marked failed");
        // exactly one Novu trigger fired (whatsapp); sms never reached Novu
        verify(novuClient, times(1)).triggerWithProviderConfig(any(), any(), any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void noEnabledChannels_dispatchesNothing() {
        when(configServiceClient.getEnabledChannels("pb.amritsar")).thenReturn(List.of());

        List<DispatchResult> results = service.processEnabledChannels(event(), true, null);

        assertTrue(results.isEmpty());
        verifyNoInteractions(novuClient);
    }

    @Test
    void globalAllowList_excludesChannelNotAllowed() {
        config.setChannel("whatsapp");   // sms NOT globally allowed, even though tenant enabled it
        when(configServiceClient.getEnabledChannels("pb.amritsar")).thenReturn(List.of("whatsapp", "sms"));
        stubHappyRecipient();
        when(configServiceClient.resolveProvidersByChannel("pb.amritsar", "whatsapp"))
                .thenReturn(List.of(ResolvedProvider.builder().providerName("twilio").channel("whatsapp").build()));
        when(novuClient.triggerWithProviderConfig(any(), any(), any(), any(), any(), any(), any(), any(), any()))
                .thenReturn(NovuClient.NovuResponse.builder().statusCode(201).response(Map.of()).build());

        List<DispatchResult> results = service.processEnabledChannels(event(), true, null);

        assertEquals(1, results.size());   // only whatsapp dispatched
        verify(configServiceClient, never()).resolveProvidersByChannel("pb.amritsar", "sms");
    }
}
