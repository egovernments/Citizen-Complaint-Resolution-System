FROM flyway/flyway:9-alpine

# Create directories for each service's migrations
WORKDIR /flyway

# Copy all service migrations
COPY sql /flyway/sql

# Copy migration runner script
COPY migrate-all.sh /flyway/migrate-all.sh
RUN chmod +x /flyway/migrate-all.sh

ENTRYPOINT ["/flyway/migrate-all.sh"]
