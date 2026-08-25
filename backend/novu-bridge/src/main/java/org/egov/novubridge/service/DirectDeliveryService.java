package org.egov.novubridge.service;

import lombok.extern.slf4j.Slf4j;
import org.egov.novubridge.config.NovuBridgeConfiguration;
import org.egov.novubridge.util.PiiMask;
import org.egov.tracer.model.CustomException;
import org.springframework.mail.MailException;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.util.UriComponentsBuilder;
import org.w3c.dom.Document;
import org.xml.sax.InputSource;

import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.StringReader;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

/**
 * Delivers SMS/Email WITHOUT Novu — for channels listed in
 * {@code novu.bridge.direct.channels} (see {@link NovuBridgeConfiguration#isDirectChannel}),
 * for deployments where {@code novu-api} can't run at all.
 *
 * <p>SMS talks directly to the Ozeki gateway's classic HTTP API: a GET with
 * recipient/message/credentials as query params, XML response. This is the
 * exact contract the Novu-side {@code OzekiOverridesBuilder} path exists to
 * satisfy via Novu's generic-sms provider; here there is no Novu provider
 * format constraint (novu-bridge is the caller), so the request is built and
 * the response parsed directly — no adapter process needed.
 *
 * <p>Every method returns a {@link NovuClient.NovuResponse} (statusCode +
 * response body) — the same shape {@code NovuClient} returns — so
 * {@code DispatchPipelineService} can treat direct and Novu-routed
 * deliveries identically after this call returns.
 */
@Service
@Slf4j
public class DirectDeliveryService {

    private final RestTemplate restTemplate;
    private final JavaMailSender mailSender;
    private final NovuBridgeConfiguration config;

    public DirectDeliveryService(RestTemplate restTemplate, JavaMailSender mailSender, NovuBridgeConfiguration config) {
        this.restTemplate = restTemplate;
        this.mailSender = mailSender;
        this.config = config;
    }

    /**
     * Send an SMS straight to the Ozeki gateway's classic HTTP API
     * ({@code GET /api?action=sendmessage&username=...&password=...&recipient=...
     * &messagetype=SMS:TEXT&messagedata=...}), parsing its XML response.
     * Never logs the request URL (carries the password) or the raw XML body —
     * only the parsed outcome, masked where it carries the recipient.
     */
    public NovuClient.NovuResponse sendSms(String phone, String body, String transactionId) {
        try {
            URI uri = UriComponentsBuilder.fromHttpUrl(config.getOzekiDirectBaseUrl() + "/api")
                    .queryParam("action", "sendmessage")
                    .queryParam("username", config.getOzekiDirectUsername())
                    .queryParam("password", config.getOzekiDirectPassword())
                    .queryParam("recipient", phone)
                    .queryParam("messagetype", "SMS:TEXT")
                    .queryParam("messagedata", body)
                    .build()
                    .encode(StandardCharsets.UTF_8)
                    .toUri();

            log.info("Ozeki direct SMS send: recipient={} txn={}", PiiMask.mask(phone), transactionId);
            String rawXml = restTemplate.getForObject(uri, String.class);
            if (!StringUtils.hasText(rawXml)) {
                throw new CustomException("NB_DIRECT_SMS_FAILED", "Ozeki returned an empty response");
            }

            Document doc = parseXml(rawXml);
            String action = textOf(doc, "action");
            if ("error".equalsIgnoreCase(action)) {
                String errorCode = textOf(doc, "errorcode");
                String errorMessage = textOf(doc, "errormessage");
                log.warn("Ozeki direct SMS rejected: txn={} errorcode={} errormessage={}",
                        transactionId, errorCode, errorMessage);
                Map<String, Object> response = new HashMap<>();
                response.put("errorcode", errorCode);
                response.put("errormessage", errorMessage);
                return NovuClient.NovuResponse.builder().statusCode(502).response(response).build();
            }

            String messageId = textOf(doc, "messageid");
            String statusCode = textOf(doc, "statuscode");
            log.info("Ozeki direct SMS accepted: txn={} messageId={} statuscode={}",
                    transactionId, messageId, statusCode);
            Map<String, Object> response = new HashMap<>();
            response.put("messageid", messageId);
            response.put("statuscode", statusCode);
            return NovuClient.NovuResponse.builder().statusCode(200).response(response).build();
        } catch (CustomException ce) {
            throw ce;
        } catch (Exception e) {
            log.error("Ozeki direct SMS failed: txn={}", transactionId, e);
            throw new CustomException("NB_DIRECT_SMS_FAILED", "Failed sending direct SMS via Ozeki: " + e.getMessage());
        }
    }

    /** Send an email straight over SMTP via the auto-configured {@link JavaMailSender}. */
    public NovuClient.NovuResponse sendEmail(String to, String subject, String body, String transactionId) {
        try {
            SimpleMailMessage message = new SimpleMailMessage();
            message.setFrom(config.getDirectEmailFrom());
            message.setTo(to);
            message.setSubject(subject);
            message.setText(body);

            log.info("Direct SMTP email send: to={} txn={}", PiiMask.mask(to), transactionId);
            mailSender.send(message);

            Map<String, Object> response = new HashMap<>();
            response.put("transactionId", transactionId);
            return NovuClient.NovuResponse.builder().statusCode(200).response(response).build();
        } catch (MailException e) {
            log.error("Direct SMTP email failed: txn={}", transactionId, e);
            throw new CustomException("NB_DIRECT_EMAIL_FAILED", "Failed sending direct email via SMTP: " + e.getMessage());
        }
    }

    /** Ozeki's response is a trivial, non-nested shape — disallow DOCTYPEs (XXE hardening) and parse with the JDK's built-in DOM parser, no extra dependency needed. */
    private Document parseXml(String xml) throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        DocumentBuilder builder = factory.newDocumentBuilder();
        return builder.parse(new InputSource(new StringReader(xml)));
    }

    private static String textOf(Document doc, String tag) {
        var nodes = doc.getElementsByTagName(tag);
        return nodes.getLength() == 0 ? null : nodes.item(0).getTextContent();
    }
}
