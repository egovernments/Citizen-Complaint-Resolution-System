FROM flyway/flyway:9.22-alpine

USER root

RUN mkdir -p /flyway/sql

COPY ./migration/main /flyway/sql

COPY migrate.sh /usr/bin/migrate.sh

RUN chmod +x /usr/bin/migrate.sh

ENTRYPOINT []
CMD ["/usr/bin/migrate.sh"]