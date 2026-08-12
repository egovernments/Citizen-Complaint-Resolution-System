package org.egov.pgr.analytics;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.jayway.jsonpath.JsonPath;
import lombok.extern.slf4j.Slf4j;
import org.egov.common.contract.request.RequestInfo;
import org.egov.common.utils.MultiStateInstanceUtil;
import org.egov.mdms.model.MasterDetail;
import org.egov.mdms.model.MdmsCriteria;
import org.egov.mdms.model.MdmsCriteriaReq;
import org.egov.mdms.model.ModuleDetail;
import org.egov.pgr.analytics.model.DashboardPack;
import org.egov.pgr.analytics.model.KpiDefinition;
import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.repository.ServiceRequestRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.stream.Collectors;

/**
 * Loads KpiDefinition and DashboardPack records from MDMS (dss module) and applies
 * visibility filtering by status + caller roles.
 *
 * Uses the exact same MDMS client pattern as {@link org.egov.pgr.util.MDMSUtils}:
 * MdmsCriteriaReq built with builder, posted via ServiceRequestRepository.fetchResult,
 * result parsed with JsonPath.
 */
@Service
@Slf4j
public class KpiCatalogService {

    private static final String DSS_MODULE = "dss";
    private static final String MASTER_KPI  = "KpiDefinition";
    private static final String MASTER_PACK = "DashboardPack";

    private final PGRConfiguration config;
    private final ServiceRequestRepository serviceRequestRepository;
    private final MultiStateInstanceUtil multiStateInstanceUtil;
    private final ObjectMapper mapper;

    @Autowired
    public KpiCatalogService(PGRConfiguration config,
                             ServiceRequestRepository serviceRequestRepository,
                             MultiStateInstanceUtil multiStateInstanceUtil,
                             ObjectMapper mapper) {
        this.config = config;
        this.serviceRequestRepository = serviceRequestRepository;
        this.multiStateInstanceUtil = multiStateInstanceUtil;
        this.mapper = mapper;
    }

    /**
     * Returns all published KpiDefinitions that are visible to the given caller roles,
     * scoped to the state-root tenant derived from tenantId.
     * Returns an empty list (never throws) when the dss module does not exist in MDMS.
     */
    public List<KpiDefinition> getVisibleDefs(String tenantId, Set<String> callerRoles) {
        String stateRoot = multiStateInstanceUtil.getStateLevelTenant(tenantId);
        List<KpiDefinition> all = fetchDefs(stateRoot);
        return all.stream()
                .filter(KpiDefinition::isPublished)
                .filter(d -> d.isVisibleTo(callerRoles))
                .collect(Collectors.toList());
    }

    /**
     * Returns the first DashboardPack whose roles overlap the caller's roles, searching
     * from MDMS for the state-root tenant. Returns Optional.empty() when none match or
     * when the dss module does not exist.
     */
    public Optional<DashboardPack> getBestPack(String tenantId, Set<String> callerRoles,
                                               List<KpiDefinition> visibleDefs) {
        String stateRoot = multiStateInstanceUtil.getStateLevelTenant(tenantId);
        Set<String> visibleIds = visibleDefs.stream()
                .map(KpiDefinition::getId)
                .collect(Collectors.toSet());

        return fetchPacks(stateRoot).stream()
                .filter(p -> p.matchesRoles(callerRoles))
                // Filter pack tiles down to only what the caller can actually see
                .peek(p -> {
                    if (p.getTiles() != null)
                        p.setTiles(p.getTiles().stream().filter(visibleIds::contains).collect(Collectors.toList()));
                    if (p.getLayout() != null)
                        p.setLayout(p.getLayout().stream()
                                .filter(e -> visibleIds.contains(e.getKpiId()))
                                .collect(Collectors.toList()));
                })
                .findFirst();
    }

    /**
     * Returns a single KpiDefinition by id (no visibility check — the caller must apply
     * isVisibleTo separately). Returns Optional.empty() when not found or MDMS unavailable.
     */
    public Optional<KpiDefinition> getDef(String kpiId, String tenantId) {
        String stateRoot = multiStateInstanceUtil.getStateLevelTenant(tenantId);
        return fetchDefs(stateRoot).stream()
                .filter(d -> kpiId.equals(d.getId()))
                .findFirst();
    }

    // ---- private MDMS helpers ----

    private List<KpiDefinition> fetchDefs(String stateRoot) {
        return fetchMaster(stateRoot, MASTER_KPI, new TypeReference<List<KpiDefinition>>() {});
    }

    private List<DashboardPack> fetchPacks(String stateRoot) {
        return fetchMaster(stateRoot, MASTER_PACK, new TypeReference<List<DashboardPack>>() {});
    }

    private <T> List<T> fetchMaster(String stateRoot, String masterName, TypeReference<List<T>> typeRef) {
        try {
            MdmsCriteriaReq req = buildMdmsRequest(new RequestInfo(), stateRoot, masterName);
            Object result = serviceRequestRepository.fetchResult(getMdmsSearchUrl(), req);
            if (result == null) return Collections.emptyList();

            String jsonPath = "$.MdmsRes." + DSS_MODULE + "." + masterName;
            List<Object> raw = JsonPath.read(result, jsonPath);
            if (raw == null || raw.isEmpty()) return Collections.emptyList();

            return mapper.convertValue(raw, typeRef);
        } catch (com.jayway.jsonpath.PathNotFoundException e) {
            // dss module or master not present in MDMS — graceful empty
            log.debug("MDMS path not found for {}.{} at tenant {}: {}", DSS_MODULE, masterName, stateRoot, e.getMessage());
            return Collections.emptyList();
        } catch (Exception e) {
            log.warn("Failed to load {}.{} from MDMS for tenant {}; returning empty list. Cause: {}",
                    DSS_MODULE, masterName, stateRoot, e.getMessage());
            return Collections.emptyList();
        }
    }

    private MdmsCriteriaReq buildMdmsRequest(RequestInfo requestInfo, String tenantId, String masterName) {
        MasterDetail masterDetail = MasterDetail.builder().name(masterName).build();
        ModuleDetail moduleDetail = ModuleDetail.builder()
                .moduleName(DSS_MODULE)
                .masterDetails(Collections.singletonList(masterDetail))
                .build();
        MdmsCriteria mdmsCriteria = MdmsCriteria.builder()
                .tenantId(tenantId)
                .moduleDetails(Collections.singletonList(moduleDetail))
                .build();
        return MdmsCriteriaReq.builder()
                .requestInfo(requestInfo)
                .mdmsCriteria(mdmsCriteria)
                .build();
    }

    private StringBuilder getMdmsSearchUrl() {
        return new StringBuilder().append(config.getMdmsHost()).append(config.getMdmsEndPoint());
    }
}
