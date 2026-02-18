FROM maven:3.9.9-eclipse-temurin-17 AS builder
WORKDIR /app
COPY pom.xml .
COPY src ./src
RUN mvn -q -DskipTests package

FROM eclipse-temurin:17-jre-jammy
WORKDIR /app
COPY --from=builder /app/target/novu-bridge-*.jar /app/novu-bridge.jar
ENTRYPOINT ["java", "-jar", "/app/novu-bridge.jar"]
