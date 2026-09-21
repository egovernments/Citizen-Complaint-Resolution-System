package org.egov.pgr.util;

import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.StringUtils;
import org.egov.pgr.config.PGRConfiguration;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestTemplate;

import java.util.HashMap;

/**
 * What the notification producer still fetches from outside: the shortened download link.
 *
 * <p>The localization client that used to live here (getLocalizationMessages / getUri /
 * getCustomizedMsgForPlaceholder) went with the rest of the rendering half into novu-bridge. A thin
 * event carries localization CODES, not localized text, and the bridge resolves them once per
 * recipient locale — which is the lookup pgr-services could never do correctly, because it builds
 * its placeholder values once per event. The locale rule that used to be buried in {@code getUri}
 * (the part of {@code RequestInfo.msgId} after the {@code |}) now travels on the event itself as
 * {@code localizationLocale}; see {@code ThinEventBuilder.localeFromMsgId}.
 */
@Component
@Slf4j
public class NotificationUtil {

    @Autowired
    private PGRConfiguration config;

    @Autowired
    private RestTemplate restTemplate;

    /**
     * @param actualURL Actual URL
     * @return Shortened URL
     */
    public String getShortnerURL(String actualURL) {
        HashMap<String,String> body = new HashMap<>();
        body.put("url",actualURL);
        StringBuilder builder = new StringBuilder(config.getUrlShortnerHost());
        builder.append(config.getUrlShortnerEndpoint());
        String res = restTemplate.postForObject(builder.toString(), body, String.class);

        if(StringUtils.isEmpty(res)){
            log.error("URL_SHORTENING_ERROR","Unable to shorten url: "+actualURL); ;
            return actualURL;
        }
        else return res;
    }

}
