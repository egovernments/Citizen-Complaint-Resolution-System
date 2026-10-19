package org.egov.pgr.repository;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import lombok.extern.slf4j.Slf4j;
import org.egov.tracer.model.ServiceCallException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.client.BufferingClientHttpRequestFactory;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Repository;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestTemplate;

import java.time.Duration;
import java.util.Map;

@Repository
@Slf4j
public class ServiceRequestRepository {

	private ObjectMapper mapper;

	private RestTemplate restTemplate;

	private RestTemplate timeBoxedRestTemplate;


	@Autowired
	public ServiceRequestRepository(ObjectMapper mapper, RestTemplate restTemplate,
									@Value("${pgr.search.workflow.connect-timeout-ms:2000}") int connectTimeoutMs,
									@Value("${pgr.search.workflow.read-timeout-ms:5000}") int readTimeoutMs) {
		this.mapper = mapper;
		this.restTemplate = restTemplate;
		this.timeBoxedRestTemplate = timeBoxed(restTemplate, connectTimeoutMs, readTimeoutMs);
	}

	/**
	 * The shared RestTemplate has no timeouts. Calls made on every complaint search/count (the
	 * workflow assignee lookups) use this copy instead, so a hung workflow fails the call rather
	 * than pinning the request thread. Same converters, interceptors and error handler, and the
	 * same buffering factory the tracer gives the shared template: with
	 * tracer.restTemplateDetailedLoggingEnabled its logging interceptor reads the response body,
	 * which an unbuffered response would then no longer have.
	 */
	private static RestTemplate timeBoxed(RestTemplate shared, int connectTimeoutMs, int readTimeoutMs) {
		SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
		factory.setConnectTimeout(Duration.ofMillis(connectTimeoutMs));
		factory.setReadTimeout(Duration.ofMillis(readTimeoutMs));
		RestTemplate scoped = new RestTemplate(shared.getMessageConverters());
		scoped.setInterceptors(shared.getInterceptors());
		scoped.setErrorHandler(shared.getErrorHandler());
		scoped.setRequestFactory(new BufferingClientHttpRequestFactory(factory));
		return scoped;
	}


	public Object fetchResult(StringBuilder uri, Object request) {
		return fetchResult(restTemplate, uri, request);
	}

	/** {@link #fetchResult} with connect/read timeouts, for calls on the search/count hot path. */
	public Object fetchResultWithTimeout(StringBuilder uri, Object request) {
		return fetchResult(timeBoxedRestTemplate, uri, request);
	}

	private Object fetchResult(RestTemplate template, StringBuilder uri, Object request) {
		mapper.configure(SerializationFeature.FAIL_ON_EMPTY_BEANS, false);
		Object response = null;
		try {
			response = template.postForObject(uri.toString(), request, Map.class);
		}catch(HttpClientErrorException e) {
			log.error("External Service threw an Exception: ",e);
			throw new ServiceCallException(e.getResponseBodyAsString());
		}catch(Exception e) {
			log.error("Exception while fetching from searcher: ",e);
		}

		return response;
	}
}
