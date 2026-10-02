# OpenSRE for the CCRS compose tier (docker-compose.opensre.yml).
#
# Built on the box from the pinned upstream release rather than pulled. The only
# published image (ghcr.io/tracer-cloud/opensre) stops at 0.1.2026.7.28, which
# predates `opensre ask`, the headless command run-sweeps.sh drives. The release
# tarball is a self-contained PyInstaller build, so this is a slim base plus one
# checksum-verified download: no pip resolution, nothing floating at build time.
#
# Bumping the version: change OPENSRE_VERSION and both checksums together. The
# checksums are the release's own `.sha256` assets; the build fails on mismatch.
FROM debian:bookworm-slim

ARG OPENSRE_VERSION=0.1.2026.9.21
ARG OPENSRE_SHA256_AMD64=010c054aa94947f09869d9c878de0557f434990aa2cdf1a0ad3821aa3d48b491
ARG OPENSRE_SHA256_ARM64=516fd285b0c0466ee3a357af03bb0f030406d2a21cace9551497a0aa97a617f4

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl jq \
 && rm -rf /var/lib/apt/lists/*

RUN set -eu; \
    case "$(dpkg --print-architecture)" in \
      amd64) asset=linux-x64;   sum="$OPENSRE_SHA256_AMD64" ;; \
      arm64) asset=linux-arm64; sum="$OPENSRE_SHA256_ARM64" ;; \
      *) echo "unsupported architecture: $(dpkg --print-architecture)" >&2; exit 1 ;; \
    esac; \
    curl -fsSL -o /tmp/opensre.tgz \
      "https://github.com/Tracer-Cloud/opensre/releases/download/v${OPENSRE_VERSION}/opensre_${OPENSRE_VERSION}_${asset}.tar.gz"; \
    echo "${sum}  /tmp/opensre.tgz" | sha256sum -c -; \
    tar xzf /tmp/opensre.tgz -C /opt; \
    rm /tmp/opensre.tgz; \
    ln -s /opt/opensre/opensre /usr/local/bin/opensre

# Create /opt/ccrs first: a COPY --chmod that creates the parent directory
# gives the directory the file's mode too (0644, no search bit), and the
# non-root user could then not read anything inside it.
RUN install -d -m 0755 /opt/ccrs
COPY --chmod=0755 run-sweeps.sh /usr/local/bin/run-sweeps
COPY --chmod=0644 guardrails.yml /opt/ccrs/guardrails.yml

RUN useradd --uid 10001 --create-home --shell /usr/sbin/nologin opensre \
 && mkdir -p /var/log/opensre \
 && chown opensre /var/log/opensre

USER opensre
ENTRYPOINT ["/usr/local/bin/run-sweeps"]
