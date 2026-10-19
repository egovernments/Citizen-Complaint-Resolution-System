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
#
# The model is reached through the Claude Code CLI (see claude-locked), the one
# Anthropic route on which OpenSRE applies guardrails.yml. It is pinned the
# same way: CLAUDE_CODE_VERSION plus both checksums, from that release's
# manifest.json (https://downloads.claude.ai/claude-code-releases/<v>/manifest.json).
#
# No Python, ever. OpenSRE auto-approves its execute_python_code tool (it
# declares itself read-only, with model-settable network access) and offers it
# whenever a python3 or python is on PATH. Neither this base nor the two
# self-contained binaries ships one; run-sweeps.sh refuses to start if one
# appears, and the parity test fails on a python package here.
FROM debian:bookworm-slim

ARG OPENSRE_VERSION=0.1.2026.9.21
ARG OPENSRE_SHA256_AMD64=010c054aa94947f09869d9c878de0557f434990aa2cdf1a0ad3821aa3d48b491
ARG OPENSRE_SHA256_ARM64=516fd285b0c0466ee3a357af03bb0f030406d2a21cace9551497a0aa97a617f4
ARG CLAUDE_CODE_VERSION=2.1.287
ARG CLAUDE_CODE_SHA256_AMD64=3920489a5109cff5786a1a392c25277408ff22bc796d5edb9c16a60e5a1718f0
ARG CLAUDE_CODE_SHA256_ARM64=e4daf793d1e74fb0d9874dd09e98690bbfd7be515f78a87fd05b9e2b4bb33b03

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

# The real CLI stays off PATH: OpenSRE finds `claude` on PATH (and
# CLAUDE_CODE_BIN names it too), and that is the locked wrapper.
RUN set -eu; \
    case "$(dpkg --print-architecture)" in \
      amd64) platform=linux-x64;   sum="$CLAUDE_CODE_SHA256_AMD64" ;; \
      arm64) platform=linux-arm64; sum="$CLAUDE_CODE_SHA256_ARM64" ;; \
      *) echo "unsupported architecture: $(dpkg --print-architecture)" >&2; exit 1 ;; \
    esac; \
    install -d -m 0755 /opt/claude-code; \
    curl -fsSL -o /opt/claude-code/claude \
      "https://downloads.claude.ai/claude-code-releases/${CLAUDE_CODE_VERSION}/${platform}/claude"; \
    echo "${sum}  /opt/claude-code/claude" | sha256sum -c -; \
    chmod 0755 /opt/claude-code/claude
COPY --chmod=0755 claude-locked /usr/local/bin/claude
ENV CLAUDE_CODE_BIN=/usr/local/bin/claude

# Create /opt/ccrs first: a COPY --chmod that creates the parent directory
# gives the directory the file's mode too (0644, no search bit), and the
# non-root user could then not read anything inside it. runbook/ is where both
# tiers mount the known-issues runbook; empty in the image.
RUN install -d -m 0755 /opt/ccrs /opt/ccrs/runbook
COPY --chmod=0755 run-sweeps.sh /usr/local/bin/run-sweeps
COPY --chmod=0644 guardrails.yml /opt/ccrs/guardrails.yml

RUN useradd --uid 10001 --create-home --shell /usr/sbin/nologin opensre \
 && mkdir -p /var/log/opensre \
 && chown opensre /var/log/opensre

USER opensre
ENTRYPOINT ["/usr/local/bin/run-sweeps"]
