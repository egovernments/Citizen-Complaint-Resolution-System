# One-shot image for the Overture bootstrap pipeline (scrape -> admin levels ->
# hierarchy). Used by the `bootstrap` service in ../docker-compose.yml.
# geopandas/shapely/duckdb ship manylinux wheels, so a slim python base with no
# system GDAL/GEOS is enough.
FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Deps are baked into the image; skip the host-venv branch in bootstrap.sh.
ENV TURBOPASS_SKIP_VENV=1
# Written to the volume mounted by docker-compose.
ENV OVERTURE_DB_PATH=/overture-data/boundaries.sqlite

ENTRYPOINT ["./bootstrap.sh"]
