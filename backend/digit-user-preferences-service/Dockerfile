# Build stage - maven image with JDK 17 (supports amd64 + arm64)
FROM maven:3.9-eclipse-temurin-17 AS build

ARG WORK_DIR=.

WORKDIR /app

# Copy the project files
COPY ${WORK_DIR}/pom.xml ./pom.xml

COPY ${WORK_DIR}/src ./src
RUN mvn -B -f /app/pom.xml package -DskipTests

# Runtime stage - JRE 17 (supports amd64 + arm64)
FROM eclipse-temurin:17-jre

WORKDIR /opt/egov

COPY --from=build /app/target/*.jar /opt/egov/

RUN useradd -r -s /bin/sh egov && \
    chown -R egov:egov /opt/egov

USER egov

EXPOSE 8080

# /health is served at the root, not under the API context path — see
# HealthController. Every probe for this service points at exactly this path.
# The port is read from the environment rather than hardcoded so the check
# still works when SERVER_PORT is overridden.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -f "http://localhost:${SERVER_PORT:-8080}/health" || exit 1

CMD ["sh", "-c", "java ${JAVA_OPTS:--Xmx192m -Xms192m} ${JAVA_ARGS} -jar /opt/egov/*.jar"]
