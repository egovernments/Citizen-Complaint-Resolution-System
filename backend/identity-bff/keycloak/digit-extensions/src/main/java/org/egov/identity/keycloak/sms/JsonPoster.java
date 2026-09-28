package org.egov.identity.keycloak.sms;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Map;

/** POSTs a JSON body and returns the status code; a seam for tests. */
public interface JsonPoster {

    int post(URI uri, String json, Map<String, String> headers) throws IOException, InterruptedException;

    static JsonPoster http() {
        HttpClient client = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(3))
                .followRedirects(HttpClient.Redirect.NEVER)
                .build();
        return (uri, json, headers) -> {
            HttpRequest.Builder request = HttpRequest.newBuilder(uri)
                    .timeout(Duration.ofSeconds(5))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(json));
            headers.forEach(request::header);
            return client.send(request.build(), HttpResponse.BodyHandlers.discarding()).statusCode();
        };
    }
}
