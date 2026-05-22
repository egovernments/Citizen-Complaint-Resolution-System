package org.egov.pgr.service;

import org.egov.pgr.repository.DashboardRepository;
import org.egov.pgr.web.models.DashboardResponse;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Service
public class DashboardService {

    private final DashboardRepository repository;

    @Autowired
    public DashboardService(DashboardRepository repository) {
        this.repository = repository;
    }

    public DashboardResponse getDashboardData(String tenantId, Long fromDate, Long toDate) {
        if (fromDate != null) {
            return repository.queryFiltered(tenantId, fromDate, toDate);
        }
        return repository.queryFromMVs(tenantId);
    }
}
