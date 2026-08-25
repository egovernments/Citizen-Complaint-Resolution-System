# db-history-normalize — see docs/superpowers/specs/2026-07-13-ansible-flyway-history-normalization-design.md
#
# postgres:16 gives us psql; it does NOT ship python3, so install it.
# Docker Hub, not the retired Flywheel mirror (#1503) — that host's wildcard
# cert expired 2026-07-25, so this FROM failed x509 on any box without an
# insecure_registries entry. db-history-normalize is built on EVERY deploy
# (docker-compose.migrations.yml) and pgr-services-migration waits on it.
ARG POSTGRES_IMAGE=egovio/postgres:16
FROM ${POSTGRES_IMAGE}

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-yaml \
 && rm -rf /var/lib/apt/lists/*

COPY normalize.py /usr/local/bin/normalize.py

ENTRYPOINT ["python3", "/usr/local/bin/normalize.py"]
