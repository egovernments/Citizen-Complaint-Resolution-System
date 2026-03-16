FROM maven:3.9.6-eclipse-temurin-17 AS build
WORKDIR /workspace
COPY pom.xml .
COPY src src
RUN mvn -q -DskipTests package

FROM eclipse-temurin:17-jre
WORKDIR /app
COPY --from=build /workspace/target/temporal-workflow-engine-1.0.0-SNAPSHOT.jar app.jar
EXPOSE 8096
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
