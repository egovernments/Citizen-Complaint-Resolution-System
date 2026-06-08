package org.egov.pgr.config;

import org.springframework.cache.CacheManager;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.cache.RedisCacheConfiguration;
import org.springframework.data.redis.cache.RedisCacheManager;
import org.springframework.data.redis.connection.RedisConnectionFactory;

import java.time.Duration;
import java.util.Map;

@Configuration
public class CacheConfig {

    public static final String BOUNDARY_CACHE              = "pgr-boundary";
    public static final String INDIVIDUAL_CACHE            = "pgr-individual";
    public static final String REGISTRY_SERVICE_CAT_CACHE  = "pgr-service-category";

    @Bean
    public CacheManager cacheManager(RedisConnectionFactory factory) {
        RedisCacheConfiguration defaults = RedisCacheConfiguration.defaultCacheConfig()
                .disableCachingNullValues();

        Map<String, RedisCacheConfiguration> cacheConfigs = Map.of(
                BOUNDARY_CACHE,             defaults.entryTtl(Duration.ofMinutes(30)),
                INDIVIDUAL_CACHE,           defaults.entryTtl(Duration.ofMinutes(10)),
                REGISTRY_SERVICE_CAT_CACHE, defaults.entryTtl(Duration.ofMinutes(60))
        );

        return RedisCacheManager.builder(factory)
                .cacheDefaults(defaults)
                .withInitialCacheConfigurations(cacheConfigs)
                .build();
    }
}
