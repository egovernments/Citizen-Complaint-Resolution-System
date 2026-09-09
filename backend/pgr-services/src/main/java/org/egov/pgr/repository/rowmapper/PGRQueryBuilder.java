package org.egov.pgr.repository.rowmapper;

import org.egov.pgr.config.PGRConfiguration;
import org.egov.pgr.policy.PgrSearchScope;
import org.egov.pgr.web.models.RequestSearchCriteria;
import org.egov.tracer.model.CustomException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Repository;
import org.springframework.util.CollectionUtils;
import org.springframework.util.StringUtils;

import java.time.Instant;
import java.util.Calendar;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Repository
public class PGRQueryBuilder {

	private PGRConfiguration config;

	@Autowired
    public PGRQueryBuilder(PGRConfiguration config) {
        this.config = config;
	}


    private static final String QUERY_ALIAS =   "ser.id as ser_id,ads.id as ads_id," +
                                                "ser.tenantId as ser_tenantId,ads.tenantId as ads_tenantId," +
                                                "ser.additionaldetails as ser_additionaldetails,ads.additionaldetails as ads_additionaldetails," +
                                                "ser.createdby as ser_createdby,ser.createdtime as ser_createdtime," +
                                                "ser.lastmodifiedby as ser_lastmodifiedby,ser.lastmodifiedtime as ser_lastmodifiedtime," +
                                                "ads.createdby as ads_createdby,ads.createdtime as ads_createdtime," +
                                                "ads.lastmodifiedby as ads_lastmodifiedby,ads.lastmodifiedtime as ads_lastmodifiedtime " ;


    private static final String QUERY = "select ser.*,ads.*," + QUERY_ALIAS+
                                        " from {schema}.eg_pgr_service_v2 ser INNER JOIN {schema}.eg_pgr_address_v2 ads" +
                                        " ON ads.parentId = ser.id ";

    private static final String COUNT_WRAPPER = "select count(*) from ({INTERNAL_QUERY}) as count";

    private static final String RESOLVED_COMPLAINTS_QUERY = "select count(*) from {schema}.eg_pgr_service_v2 where applicationstatus='CLOSEDAFTERRESOLUTION' and tenantid=? and lastmodifiedtime>? ";

    private static final String AVERAGE_RESOLUTION_TIME_QUERY = "select round(avg(lastmodifiedtime-createdtime)/86400000) from {schema}.eg_pgr_service_v2 where applicationstatus='CLOSEDAFTERRESOLUTION' and tenantid=? ";



    public String getPGRSearchQuery(RequestSearchCriteria criteria, List<Object> preparedStmtList) {
        return getPGRSearchQuery(criteria, preparedStmtList, null, PgrSearchScope.UNRESTRICTED);
    }

    public String getPGRSearchQuery(RequestSearchCriteria criteria, List<Object> preparedStmtList, Map<String, Long> serviceCodeToSla) {
        return getPGRSearchQuery(criteria, preparedStmtList, serviceCodeToSla, PgrSearchScope.UNRESTRICTED);
    }

    /**
     * @param scope server-derived RBAC restriction (citizen-self / employee-department), or
     *              {@link PgrSearchScope#UNRESTRICTED} for an explicitly-approved unrestricted
     *              caller (e.g. plainSearch). NEVER sourced from client-controlled request fields
     *              — see {@link org.egov.pgr.policy.SearchAccessPolicyService}. Never pass
     *              {@code null}: see {@link #applyScope}.
     */
    public String getPGRSearchQuery(RequestSearchCriteria criteria, List<Object> preparedStmtList, Map<String, Long> serviceCodeToSla, PgrSearchScope scope) {

        StringBuilder builder = buildFilteredQuery(criteria, preparedStmtList, scope);

        addOrderByClause(builder, criteria, preparedStmtList, serviceCodeToSla);

        addLimitAndOffset(builder, criteria, preparedStmtList);

        return builder.toString();
    }

    /**
     * The tenant/criteria/scope predicates shared by both the paginated search query and the count
     * query — deliberately WITHOUT ordering or pagination, since a count must reflect the full
     * scoped result set regardless of the requested page/limit.
     */
    private StringBuilder buildFilteredQuery(RequestSearchCriteria criteria, List<Object> preparedStmtList, PgrSearchScope scope) {

        StringBuilder builder = new StringBuilder(QUERY);

        if(criteria.getIsPlainSearch() != null && criteria.getIsPlainSearch()){
            Set<String> tenantIds = criteria.getTenantIds();
            if(!CollectionUtils.isEmpty(tenantIds)){
                addClauseIfRequired(preparedStmtList, builder);
                builder.append(" ser.tenantId IN (").append(createQuery(tenantIds)).append(")");
                addToPreparedStatement(preparedStmtList, tenantIds);
            }
        }
        else {
            if (criteria.getTenantId() != null) {
                String tenantId = criteria.getTenantId();

                String[] tenantIdChunks = tenantId.split("\\.");

                if (tenantIdChunks.length == config.getStateLevelTenantIdLength()) {
                    addClauseIfRequired(preparedStmtList, builder);
                    builder.append(" ser.tenantid LIKE ? ");
                    preparedStmtList.add(criteria.getTenantId() + '%');
                } else {
                    addClauseIfRequired(preparedStmtList, builder);
                    builder.append(" ser.tenantid=? ");
                    preparedStmtList.add(criteria.getTenantId());
                }
            }
        }
        Set<String> serviceCodes = criteria.getServiceCode();
        if (!CollectionUtils.isEmpty(serviceCodes)) {
            addClauseIfRequired(preparedStmtList, builder);
            builder.append(" ser.serviceCode IN (").append(createQuery(serviceCodes)).append(")");
            addToPreparedStatement(preparedStmtList, serviceCodes);
        }

        Set<String> applicationStatuses = criteria.getApplicationStatus();
        if (!CollectionUtils.isEmpty(applicationStatuses)) {
            addClauseIfRequired(preparedStmtList, builder);
            builder.append(" ser.applicationStatus IN (").append(createQuery(applicationStatuses)).append(")");
            addToPreparedStatement(preparedStmtList, applicationStatuses);
        }

        if (criteria.getServiceRequestId() != null) {
            addClauseIfRequired(preparedStmtList, builder);
            builder.append(" ser.serviceRequestId=? ");
            preparedStmtList.add(criteria.getServiceRequestId());
        }

        Set<String> ids = criteria.getIds();
        if (!CollectionUtils.isEmpty(ids)) {
            addClauseIfRequired(preparedStmtList, builder);
            builder.append(" ser.id IN (").append(createQuery(ids)).append(")");
            addToPreparedStatement(preparedStmtList, ids);
        }

        //When UI tries to fetch "escalated" complaints count.
        if(criteria.getSlaDeltaMaxLimit() != null && criteria.getSlaDeltaMinLimit() == null){
            addClauseIfRequired(preparedStmtList, builder);
            builder.append(" ((extract(epoch FROM NOW())*1000) - ser.createdtime) > ? ");
            preparedStmtList.add(criteria.getSlaDeltaMaxLimit());
        }
        //When UI tries to fetch "other" complaints count.
        if(criteria.getSlaDeltaMaxLimit() != null && criteria.getSlaDeltaMinLimit() != null){
            addClauseIfRequired(preparedStmtList, builder);
            builder.append(" ((extract(epoch FROM NOW())*1000) - ser.createdtime) > ? ");
            preparedStmtList.add(criteria.getSlaDeltaMinLimit());
            addClauseIfRequired(preparedStmtList, builder);
            builder.append(" ((extract(epoch FROM NOW())*1000) - ser.createdtime) < ? ");
            preparedStmtList.add(criteria.getSlaDeltaMaxLimit());
        }

        Set<String> userIds = criteria.getUserIds();
        if (!CollectionUtils.isEmpty(userIds)) {
            addClauseIfRequired(preparedStmtList, builder);
            builder.append(" ser.accountId IN (").append(createQuery(userIds)).append(")");
            addToPreparedStatement(preparedStmtList, userIds);
        }

        Set<String> serviceRequestIds = criteria.getServiceRequestIds();
        if (!CollectionUtils.isEmpty(serviceRequestIds)) {
            addClauseIfRequired(preparedStmtList, builder);
            builder.append(" ser.serviceRequestId IN (").append(createQuery(serviceRequestIds)).append(")");
            addToPreparedStatement(preparedStmtList, serviceRequestIds);
        }

        // Visibility (reportee-scoped All): team-assigned complaints OR the
        // unassigned queues, in one predicate so pagination and count stay
        // correct. Set only by VisibilityService.
        Set<String> visibilityIds = criteria.getVisibilityIds();
        Set<String> visibilityStates = criteria.getVisibilityUnassignedStates();
        if (!CollectionUtils.isEmpty(visibilityIds) || !CollectionUtils.isEmpty(visibilityStates)) {
            addClauseIfRequired(preparedStmtList, builder);
            builder.append(" ( ");
            boolean hasIds = !CollectionUtils.isEmpty(visibilityIds);
            if (hasIds) {
                builder.append(" ser.serviceRequestId IN (").append(createQuery(visibilityIds)).append(")");
                addToPreparedStatement(preparedStmtList, visibilityIds);
            }
            if (!CollectionUtils.isEmpty(visibilityStates)) {
                if (hasIds)
                    builder.append(" OR ");
                builder.append(" ser.applicationStatus IN (").append(createQuery(visibilityStates)).append(")");
                addToPreparedStatement(preparedStmtList, visibilityStates);
            }
            builder.append(" ) ");
        }


        Set<String> localities = criteria.getLocality();
        if(!CollectionUtils.isEmpty(localities)){
            addClauseIfRequired(preparedStmtList, builder);
            builder.append(" ads.locality IN (").append(createQuery(localities)).append(")");
            addToPreparedStatement(preparedStmtList, localities);
        }

        if (criteria.getFromDate() != null) {
            addClauseIfRequired(preparedStmtList, builder);

            //If user does not specify toDate, take today's date as toDate by default.
            if (criteria.getToDate() == null) {
                criteria.setToDate(Instant.now().toEpochMilli());
            }

            builder.append(" ser.createdtime BETWEEN ? AND ?");
            preparedStmtList.add(criteria.getFromDate());
            preparedStmtList.add(criteria.getToDate());

        } else {
            //if only toDate is provided as parameter without fromDate parameter, throw an exception.
            if (criteria.getToDate() != null) {
                throw new CustomException("INVALID_SEARCH", "Cannot specify to-Date without a from-Date");
            }
        }


        applyScope(scope, builder, preparedStmtList);

        return builder;
    }

    /**
     * Injects the RBAC scope's WHERE predicates. Mirrors the same axes/pattern as
     * {@code AnalyticsPlanner.applyScope} in the analytics module (citizen self-scope, employee
     * department-scope, and — per {@link PgrSearchScope}'s own Javadoc — the tenant axis itself),
     * plus PGR search's own jurisdiction axis: an exact-match IN-list against the complaint's
     * address locality, but {@code PgrSearchScope#jurisdictionCodes} itself already carries every
     * DESCENDANT of each HRMS-assigned boundary (see {@code PolicyDrivenScopeResolver} /
     * {@code BoundaryHierarchyExpander}), so this exact match still behaves like a hierarchical
     * cascade for a coarse-grained jurisdiction assignment — the same cascade the analytics
     * module's {@code AnalyticsPlanner} achieves independently via ancestor-path segment
     * matching, since both read from the same resolved {@code jurisdictionCodes}.
     *
     * <p>{@code scope == null} is fail-closed, not "unrestricted": a missing scope on this path is
     * a wiring bug (a caller forgot to resolve/pass one), and silently treating that as no
     * restriction is exactly the RBAC hole this method exists to prevent. An intentionally
     * unrestricted caller (plainSearch, internal fetch-by-id/update-reconciliation) must pass
     * {@link PgrSearchScope#UNRESTRICTED} explicitly.
     */
    private void applyScope(PgrSearchScope scope, StringBuilder builder, List<Object> preparedStmtList) {
        if (scope == null)
            throw new IllegalStateException("PGRQueryBuilder: scope must not be null on a scoped search/count "
                    + "path — pass PgrSearchScope.UNRESTRICTED explicitly for an approved unrestricted caller.");

        if (scope == PgrSearchScope.UNRESTRICTED)
            return;

        // The tenant this scope was authorized against (see PolicyDrivenScopeResolver, which
        // validates the requested tenant against the caller's own tenant/subtree before ever
        // producing a non-deny scope) — applied here rather than trusted solely from
        // criteria.getTenantId() above, so an authorization decision always reaches SQL as data,
        // never just as an unchecked echo of client input.
        if (scope.tenantId != null) {
            addClauseIfRequired(preparedStmtList, builder);
            if (scope.tenantStateLevel) {
                builder.append(" ser.tenantId LIKE ? ");
                preparedStmtList.add(scope.tenantId + '%');
            } else {
                builder.append(" ser.tenantId = ? ");
                preparedStmtList.add(scope.tenantId);
            }
        }

        if (scope.citizenUuid != null) {
            addClauseIfRequired(preparedStmtList, builder);
            builder.append(" ser.accountId = ? ");
            preparedStmtList.add(scope.citizenUuid);
        }

        // null vs empty is deliberately NOT collapsed via CollectionUtils.isEmpty here: null means
        // "axis not restricted" (skip the clause, matching every other axis's null/no-restriction
        // semantic), but a non-null EMPTY list means "this axis IS restricted and resolved to zero
        // allowed values" — ScopePolicyEngine.resolve always hands back a non-empty sentinel list
        // instead of a true empty one for that case today, but this must independently enforce
        // deny-all (not silently drop the axis and return unrestricted rows) if that contract ever
        // regresses upstream (#1441 review).
        if (scope.departmentCodes != null) {
            addClauseIfRequired(preparedStmtList, builder);
            if (scope.departmentCodes.isEmpty()) {
                builder.append(" 1 = 0 ");
            } else {
                builder.append(" ser.additionaldetails->>'department' IN (").append(createQuery(scope.departmentCodes)).append(")");
                addToPreparedStatement(preparedStmtList, scope.departmentCodes);
            }
        }

        if (scope.jurisdictionCodes != null) {
            addClauseIfRequired(preparedStmtList, builder);
            if (scope.jurisdictionCodes.isEmpty()) {
                builder.append(" 1 = 0 ");
            } else {
                builder.append(" ads.locality IN (").append(createQuery(scope.jurisdictionCodes)).append(")");
                addToPreparedStatement(preparedStmtList, scope.jurisdictionCodes);
            }
        }
    }


    public String getCountQuery(RequestSearchCriteria criteria, List<Object> preparedStmtList){
        return getCountQuery(criteria, preparedStmtList, null, PgrSearchScope.UNRESTRICTED);
    }

    public String getCountQuery(RequestSearchCriteria criteria, List<Object> preparedStmtList, Map<String, Long> serviceCodeToSla){
        return getCountQuery(criteria, preparedStmtList, serviceCodeToSla, PgrSearchScope.UNRESTRICTED);
    }

    public String getCountQuery(RequestSearchCriteria criteria, List<Object> preparedStmtList, Map<String, Long> serviceCodeToSla, PgrSearchScope scope){
        StringBuilder builder = buildFilteredQuery(criteria, preparedStmtList, scope);
        return COUNT_WRAPPER.replace("{INTERNAL_QUERY}", builder.toString());
    }

    private void addOrderByClause(StringBuilder builder, RequestSearchCriteria criteria, List<Object> preparedStmtList, Map<String, Long> serviceCodeToSla){

        if(StringUtils.isEmpty(criteria.getSortBy()))
            builder.append( " ORDER BY ser_createdtime ");

        else if(criteria.getSortBy()== RequestSearchCriteria.SortBy.locality)
            builder.append(" ORDER BY ads.locality ");

        else if(criteria.getSortBy()== RequestSearchCriteria.SortBy.applicationStatus)
            builder.append(" ORDER BY ser.applicationStatus ");

        else if(criteria.getSortBy()== RequestSearchCriteria.SortBy.serviceRequestId)
            builder.append(" ORDER BY ser.serviceRequestId ");

        else if(criteria.getSortBy()== RequestSearchCriteria.SortBy.createdTime)
            builder.append(" ORDER BY ser.createdtime ");

        // SLA-remaining ordering = (SLA budget for this complaint type) − (wall-clock
        // elapsed since creation). Done server-side so the order is consistent across
        // the FULL paginated result set; a client-side sortFunction only reorders one
        // page at a time, so rows dropped in/out of view as page size changed (#432).
        //
        // The budget is per complaint type, sourced from MDMS RAINMAKER-PGR.ComplaintHierarchy
        // leaf rows (slaHours), matching the inbox's displayed "SLA days remaining". When the map
        // is available we build a CASE ser.servicecode ...; types not present in the map
        // (and the empty-map / MDMS-failure case) fall back to the uniform business-level
        // SLA, which keeps this correct even before per-type slaHours is populated.
        else if(criteria.getSortBy()== RequestSearchCriteria.SortBy.sla){
            long defaultSla = config.getBusinessLevelSla();
            StringBuilder slaExpr = new StringBuilder();
            if (serviceCodeToSla == null || serviceCodeToSla.isEmpty()) {
                slaExpr.append("?");
                preparedStmtList.add(defaultSla);
            } else {
                slaExpr.append("CASE ser.servicecode");
                for (Map.Entry<String, Long> entry : serviceCodeToSla.entrySet()) {
                    slaExpr.append(" WHEN ? THEN ?");
                    preparedStmtList.add(entry.getKey());
                    preparedStmtList.add(entry.getValue());
                }
                slaExpr.append(" ELSE ? END");
                preparedStmtList.add(defaultSla);
            }
            builder.append(" ORDER BY ((").append(slaExpr)
                   .append(") - ((extract(epoch FROM NOW())*1000) - ser.createdtime)) ");
        }

        if(criteria.getSortOrder()== RequestSearchCriteria.SortOrder.ASC)
            builder.append(" ASC ");
        else builder.append(" DESC ");

    }

    private void addLimitAndOffset(StringBuilder builder, RequestSearchCriteria criteria, List<Object> preparedStmtList){

        builder.append(" OFFSET ? ");
        preparedStmtList.add(criteria.getOffset());

        builder.append(" LIMIT ? ");
        preparedStmtList.add(criteria.getLimit());

    }

    private static void addClauseIfRequired(List<Object> values, StringBuilder queryString) {
        if (values.isEmpty())
            queryString.append(" WHERE ");
        else {
            queryString.append(" AND");
        }
    }

    private String createQuery(Collection<String> ids) {
        StringBuilder builder = new StringBuilder();
        int length = ids.size();
        for( int i = 0; i< length; i++){
            builder.append(" ? ");
            if(i != length -1) builder.append(",");
        }
        return builder.toString();
    }

    private void addToPreparedStatement(List<Object> preparedStmtList, Collection<String> ids)
    {
        ids.forEach(id ->{ preparedStmtList.add(id);});
    }


	public String getResolvedComplaints(String tenantId, List<Object> preparedStmtListComplaintsResolved) {

		StringBuilder query = new StringBuilder("");
		query.append(RESOLVED_COMPLAINTS_QUERY);

		preparedStmtListComplaintsResolved.add(tenantId);

		// In order to get data of last 12 months, the months variables is pre-configured in application properties
    	int days = Integer.valueOf(config.getNumberOfDays()) ;

    	Calendar calendar = Calendar.getInstance();

    	// To subtract 12 months from current time, we are adding -12 to the calendar instance, as subtract function is not in-built
    	calendar.add(Calendar.DATE, -1*days);

    	// Converting the timestamp to milliseconds and adding it to prepared statement list
    	preparedStmtListComplaintsResolved.add(calendar.getTimeInMillis());

		return query.toString();
	}


	private static final String DOCUMENT_QUERY = "SELECT id, document_type, filestore_id, document_uid, service_id, additional_details, created_by, last_modified_by, created_time, last_modified_time FROM {schema}.eg_pgr_document_v2 WHERE service_id IN ({SERVICE_IDS})";

	public String getDocumentSearchQuery(List<String> serviceIds, List<Object> preparedStmtList) {
		StringBuilder placeholders = new StringBuilder();
		for (int i = 0; i < serviceIds.size(); i++) {
			placeholders.append(" ?");
			if (i != serviceIds.size() - 1) placeholders.append(",");
			preparedStmtList.add(serviceIds.get(i));
		}
		return DOCUMENT_QUERY.replace("{SERVICE_IDS}", placeholders.toString());
	}

	public String getAverageResolutionTime(String tenantId, List<Object> preparedStmtListAverageResolutionTime) {
		StringBuilder query = new StringBuilder("");
		query.append(AVERAGE_RESOLUTION_TIME_QUERY);

		preparedStmtListAverageResolutionTime.add(tenantId);

		return query.toString();
	}

}
