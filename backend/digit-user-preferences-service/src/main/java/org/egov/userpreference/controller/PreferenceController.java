package org.egov.userpreference.controller;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.egov.userpreference.service.PreferenceService;
import org.egov.userpreference.web.model.PreferenceRequest;
import org.egov.userpreference.web.model.PreferenceResponse;
import org.egov.userpreference.web.model.PreferenceSearchRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The preference API.
 *
 * <p>The context path is applied here rather than through
 * {@code server.servlet.context-path} because the Go service mounted its API
 * under {@code SERVER_CONTEXT_PATH} while leaving {@code /health} at the
 * container root. A servlet-wide context path would move the health endpoint
 * too, breaking the compose healthcheck, the Kubernetes probes and both Gatus
 * catalogues, all of which probe {@code /health}.
 */
@RestController
@RequestMapping("${user.preference.context-path}/v1")
@RequiredArgsConstructor
@Slf4j
public class PreferenceController {

    private final PreferenceService preferenceService;

    @PostMapping("/_upsert")
    public ResponseEntity<PreferenceResponse> upsert(@RequestBody PreferenceRequest request) {
        PreferenceResponse response = preferenceService.upsert(request);

        log.info("Preference upserted successfully: userId={}, preferenceCode={}",
                request.getPreference().getUserId(), request.getPreference().getPreferenceCode());

        return ResponseEntity.ok(response);
    }

    @PostMapping("/_search")
    public ResponseEntity<PreferenceResponse> search(@RequestBody PreferenceSearchRequest request) {
        PreferenceResponse response = preferenceService.search(request);

        log.info("Preferences search completed: resultCount={}, totalCount={}",
                response.getPreferences().size(), response.getPagination().getTotalCount());

        return ResponseEntity.ok(response);
    }
}
