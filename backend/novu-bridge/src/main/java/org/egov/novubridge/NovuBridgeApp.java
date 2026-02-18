package org.egov.novubridge;

import org.egov.common.utils.MultiStateInstanceUtil;
import org.egov.tracer.config.TracerConfiguration;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.ComponentScan;
import org.springframework.context.annotation.Import;

@SpringBootApplication
@ComponentScan(basePackages = {"org.egov.novubridge"})
@Import({TracerConfiguration.class, MultiStateInstanceUtil.class})
public class NovuBridgeApp {

    public static void main(String[] args) {
        SpringApplication.run(NovuBridgeApp.class, args);
    }
}
