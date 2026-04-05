package org.egov.pgr.repository;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

import org.egov.pgr.repository.rowmapper.DocumentRowMapper;
import org.egov.pgr.repository.rowmapper.PGRQueryBuilder;
import org.egov.pgr.repository.rowmapper.PGRRowMapper;
import org.egov.pgr.util.PGRConstants;
import org.egov.pgr.util.PGRUtils;
import org.egov.pgr.web.models.Document;
import org.egov.pgr.web.models.RequestSearchCriteria;
import org.egov.pgr.web.models.Service;
import org.egov.pgr.web.models.ServiceWrapper;
import org.egov.pgr.web.models.Workflow;
import org.egov.tracer.model.CustomException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.util.CollectionUtils;

import lombok.extern.slf4j.Slf4j;

@Repository
@Slf4j
public class PGRRepository {


    private PGRQueryBuilder queryBuilder;

    private PGRRowMapper rowMapper;

    private DocumentRowMapper documentRowMapper;

    private JdbcTemplate jdbcTemplate;

    private PGRUtils utils;


    @Autowired
    public PGRRepository(PGRQueryBuilder queryBuilder, PGRRowMapper rowMapper, DocumentRowMapper documentRowMapper, JdbcTemplate jdbcTemplate, PGRUtils utils) {
        this.queryBuilder = queryBuilder;
        this.rowMapper = rowMapper;
        this.documentRowMapper = documentRowMapper;
        this.jdbcTemplate = jdbcTemplate;
        this.utils = utils;
    }




    /**
     * searches services based on search criteria and then wraps it into serviceWrappers
     * @param criteria
     * @return
     */
    public List<ServiceWrapper> getServiceWrappers(RequestSearchCriteria criteria){
        List<Service> services = getServices(criteria);
        List<String> serviceRequestids = services.stream().map(Service::getServiceRequestId).collect(Collectors.toList());
        Map<String, Workflow> idToWorkflowMap = new HashMap<>();
        List<ServiceWrapper> serviceWrappers = new ArrayList<>();

        for(Service service : services){
            ServiceWrapper serviceWrapper = ServiceWrapper.builder().service(service).workflow(idToWorkflowMap.get(service.getServiceRequestId())).build();
            serviceWrappers.add(serviceWrapper);
        }
        return serviceWrappers;
    }

    /**
     * searches services based on search criteria
     * @param criteria
     * @return
     */
    public List<Service> getServices(RequestSearchCriteria criteria) {

        String tenantId = criteria.getTenantId();
        List<Object> preparedStmtList = new ArrayList<>();
        String query = queryBuilder.getPGRSearchQuery(criteria, preparedStmtList);
        try {
            query = utils.replaceSchemaPlaceholder(query, tenantId);
        } catch (Exception e) {
            throw new CustomException("PGR_UPDATE_ERROR",
                    "TenantId length is not sufficient to replace query schema in a multi state instance");
        }
        List<Service> services =  jdbcTemplate.query(query, rowMapper, preparedStmtList.toArray());
        if(!CollectionUtils.isEmpty(services)){
            enrichServicesWithDocuments(services, criteria.getTenantId());
        }
        return services;
    }

    /**
     * Fetches documents for given services and maps them (Two-Step Fetch approach)
     */
    private void enrichServicesWithDocuments(List<Service> services, String tenantId) {
        List<String> serviceIds = services.stream().map(Service::getId).collect(Collectors.toList());
        List<Object> docPreparedStmtList = new ArrayList<>();
        String docQuery = queryBuilder.getDocumentSearchQuery(serviceIds, docPreparedStmtList);
        try {
            docQuery = utils.replaceSchemaPlaceholder(docQuery, tenantId);
        } catch (Exception e) {
            throw new CustomException("PGR_DOCUMENT_SEARCH_ERROR",
                    "TenantId length is not sufficient to replace query schema in a multi state instance");
        }
        Map<String, List<Document>> serviceIdToDocuments = jdbcTemplate.query(docQuery, documentRowMapper, docPreparedStmtList.toArray());
        if(serviceIdToDocuments != null) {
            for (Service service : services) {
                service.setDocuments(serviceIdToDocuments.get(service.getId()));
            }
        }
    }

    /**
     * Returns the count based on the search criteria
     * @param criteria
     * @return
     */
    public Integer getCount(RequestSearchCriteria criteria) {

        String tenantId = criteria.getTenantId();
        List<Object> preparedStmtList = new ArrayList<>();
        String query = queryBuilder.getCountQuery(criteria, preparedStmtList);
        try {
            query = utils.replaceSchemaPlaceholder(query, tenantId);
        } catch (Exception e) {
            throw new CustomException("PGR_REQUEST_COUNT_ERROR",
                    "TenantId length is not sufficient to replace query schema in a multi state instance");
        }
        Integer count =  jdbcTemplate.queryForObject(query, Integer.class, preparedStmtList.toArray());
        return count;
    }


	public Map<String, Integer> fetchDynamicData(String tenantId) {
		List<Object> preparedStmtListCompalintsResolved = new ArrayList<>();
		String query = queryBuilder.getResolvedComplaints(tenantId,preparedStmtListCompalintsResolved );
        try {
            query = utils.replaceSchemaPlaceholder(query, tenantId);
        } catch (Exception e) {
            throw new CustomException("PGR_SEARCH_ERROR",
                    "TenantId length is not sufficient to replace query schema in a multi state instance");
        }
		int complaintsResolved = jdbcTemplate.queryForObject(query, Integer.class, preparedStmtListCompalintsResolved.toArray());

		List<Object> preparedStmtListAverageResolutionTime = new ArrayList<>();
		query = queryBuilder.getAverageResolutionTime(tenantId, preparedStmtListAverageResolutionTime);
        try {
            query = utils.replaceSchemaPlaceholder(query, tenantId);
        } catch (Exception e) {
            throw new CustomException("PGR_SEARCH_ERROR",
                    "TenantId length is not sufficient to replace query schema in a multi state instance");
        }
		Integer averageResolutionTime = jdbcTemplate.queryForObject(query, Integer.class, preparedStmtListAverageResolutionTime.toArray());
        if(averageResolutionTime == null) averageResolutionTime = 0;

        Map<String, Integer> dynamicData = new HashMap<String,Integer>();
		dynamicData.put(PGRConstants.COMPLAINTS_RESOLVED, complaintsResolved);
        dynamicData.put(PGRConstants.AVERAGE_RESOLUTION_TIME, averageResolutionTime);

		return dynamicData;
	}



}
