package org.egov.pgr.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.digit.services.individual.IndividualClient;
import org.digit.services.individual.model.Individual;
import org.digit.services.individual.model.IndividualSearchResponse;
import org.egov.pgr.web.models.RequestSearchCriteria;
import org.egov.pgr.web.models.ServiceRequest;
import org.egov.pgr.web.models.ServiceWrapper;
import org.egov.pgr.web.models.User;
import org.springframework.stereotype.Service;
import org.springframework.util.CollectionUtils;
import org.springframework.util.StringUtils;

import java.util.*;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class UserService {

    private final IndividualClient individualClient;

    /**
     * Resolves and attaches citizen info on a create/update request.
     * If accountId is present, looks up the individual and attaches to citizen field.
     * If citizen object is present but no accountId, upserts the individual.
     */
    public void callUserService(ServiceRequest request) {
        org.egov.pgr.web.models.Service service = request.getService();

        if (StringUtils.hasText(service.getAccountId())) {
            enrichCitizenFromIndividual(service);
        } else if (service.getCitizen() != null) {
            upsertIndividual(service);
        }
    }

    /**
     * Enriches citizen field on each wrapper by looking up the individual by accountId.
     */
    public void enrichUsers(List<ServiceWrapper> serviceWrappers) {
        Set<String> individualIds = serviceWrappers.stream()
                .map(sw -> sw.getService().getAccountId())
                .filter(StringUtils::hasText)
                .collect(Collectors.toSet());

        if (individualIds.isEmpty()) return;

        Map<String, User> idToUser = new HashMap<>();
        for (String individualId : individualIds) {
            try {
                Individual ind = individualClient.getIndividualById(individualId);
                if (ind != null) {
                    idToUser.put(individualId, toUser(ind));
                }
            } catch (Exception e) {
                log.warn("Could not fetch individual {}: {}", individualId, e.getMessage());
            }
        }

        serviceWrappers.forEach(sw ->
                sw.getService().setCitizen(idToUser.get(sw.getService().getAccountId())));
    }

    /**
     * Enriches userIds in search criteria from mobileNumber via individual lookup.
     */
    public void enrichUserIds(String tenantId, RequestSearchCriteria criteria) {
        String mobileNumber = criteria.getMobileNumber();
        if (!StringUtils.hasText(mobileNumber)) return;

        try {
            IndividualSearchResponse resp = individualClient.searchAllIndividuals();
            List<Individual> individuals = resp != null && resp.getIndividuals() != null
                    ? resp.getIndividuals().stream()
                            .filter(i -> mobileNumber.equals(i.getMobileNumber()))
                            .collect(Collectors.toList())
                    : Collections.emptyList();
            Set<String> userIds = individuals.stream()
                    .map(Individual::getId)
                    .filter(Objects::nonNull)
                    .collect(Collectors.toSet());
            criteria.setUserIds(userIds);
        } catch (Exception e) {
            log.warn("Failed to enrich userIds for mobileNumber {}: {}", mobileNumber, e.getMessage());
            criteria.setUserIds(Collections.emptySet());
        }
    }

    public String getFirstRoleNameByUuid(String uuid, String tenantId) {
        if (!StringUtils.hasText(uuid)) return null;
        try {
            Individual ind = individualClient.getIndividualById(uuid);
            return ind != null ? ind.getName() : null;
        } catch (Exception e) {
            log.warn("Failed to get individual by uuid {}: {}", uuid, e.getMessage());
            return null;
        }
    }

    private void enrichCitizenFromIndividual(org.egov.pgr.web.models.Service service) {
        try {
            Individual ind = individualClient.getIndividualById(service.getAccountId());
            if (ind == null) {
                log.warn("No individual found for accountId={}", service.getAccountId());
                return;
            }
            service.setCitizen(toUser(ind));
        } catch (Exception e) {
            log.warn("Failed to enrich citizen for accountId={}: {}", service.getAccountId(), e.getMessage());
        }
    }

    private void upsertIndividual(org.egov.pgr.web.models.Service service) {
        User citizen = service.getCitizen();
        try {
            IndividualSearchResponse searchResp = individualClient.searchAllIndividuals();
            List<Individual> existing = searchResp != null && searchResp.getIndividuals() != null
                    ? searchResp.getIndividuals().stream()
                            .filter(i -> citizen.getMobileNumber().equals(i.getMobileNumber()))
                            .collect(Collectors.toList())
                    : Collections.emptyList();
            if (!CollectionUtils.isEmpty(existing)) {
                Individual found = existing.get(0);
                service.setAccountId(found.getId());
                service.setCitizen(toUser(found));
            } else {
                Individual newInd = Individual.builder()
                        .name(citizen.getName())
                        .mobileNumber(citizen.getMobileNumber())
                        .email(citizen.getEmailId())
                        .gender("OTHER")
                        .build();
                Individual created = individualClient.createIndividual(newInd);
                if (created != null) {
                    service.setAccountId(created.getId());
                    service.setCitizen(toUser(created));
                }
            }
        } catch (Exception e) {
            log.error("Failed to upsert individual for citizen mobile={}: {}", citizen.getMobileNumber(), e.getMessage());
        }
    }

    private User toUser(Individual ind) {
        return User.builder()
                .uuid(ind.getId())
                .name(ind.getName())
                .mobileNumber(ind.getMobileNumber())
                .emailId(ind.getEmail())
                .active(true)
                .build();
    }
}
