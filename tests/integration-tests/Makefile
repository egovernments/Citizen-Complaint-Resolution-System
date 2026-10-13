# Test catalog dashboard — runner targets
#
# Usage:
#   make test-and-publish ENV_PROFILE=deploy/naipepea.env RUNNER_SECRETS_ENV=/etc/digit-tests/secrets.env HOST_SSH=<box>
#   BRANCH=feature/foo make test-and-publish …
#   make catalog-only                  # rebuild catalog from current report.json without re-running
#   make publish-only                  # publish current artifacts without re-running
#
# Nothing here names a box. The run reads ENV_PROFILE (tracked, deploy/<env>.env)
# and RUNNER_SECRETS_ENV (box-local persona passwords + fixed OTP), the same two
# files runner/run-cycle.sh sources; see deploy/README.md.

SHELL := /usr/bin/env bash

BRANCH ?= main
ENV_PROFILE ?=
RUNNER_SECRETS_ENV ?=
HOST_SSH ?=
HOST_DIR ?= /var/www/tests
# Runs whose full report (runs/<id>/) stays on the host; build-catalog and
# publish.sh must agree on it. Results are kept for 30 runs regardless.
RUN_LIMIT ?= 5
# Single-flight lock: this checkout's directory itself, which run-cycle.sh also
# locks when it runs here (its REPO_DIR), so a make cycle and a RUN-button or
# nightly cycle can't run in one checkout at once, whichever user starts them.
# A file in /tmp was a different file per user under systemd's PrivateTmp.
LOCK ?= $(CURDIR)

# Run-id format: 2026-05-07_1430_a1b2c3d
RUN_ID := $(shell date -u +%Y-%m-%d_%H%M)_$(shell git rev-parse --short HEAD 2>/dev/null || echo unknown)

.PHONY: test-and-publish run catalog publish prepare fetch-history

test-and-publish:
	@flock -n "$(LOCK)" -c '$(MAKE) _do-cycle' || (echo "Another run is already in progress; exiting." >&2; exit 1)

_do-cycle: prepare fetch-history run catalog publish

prepare:
	@echo "===== prepare ====="
	@git fetch --quiet --all
	@git reset --hard origin/$(BRANCH)
	@git rev-parse --short HEAD > .git-sha
	@if [[ ! -d node_modules ]] || [[ package-lock.json -nt node_modules/.package-lock.json ]]; then \
		echo "Installing dependencies..."; \
		npm ci --prefer-offline --no-audit --no-fund; \
	fi
	@npx playwright install --with-deps chromium >/dev/null 2>&1 || true
	@rm -rf playwright-report test-results report.json

fetch-history:
	@echo "===== fetch-history ====="
	@scp -o ConnectTimeout=10 $(HOST_SSH):$(HOST_DIR)/history.json ./history.json 2>/dev/null \
		|| echo "(no prior history on host; starting fresh)"

run:
	@echo "===== run (RUN_ID=$(RUN_ID), BRANCH=$(BRANCH)) ====="
	@set -a; for f in "$(ENV_PROFILE)" "$(RUNNER_SECRETS_ENV)"; do [[ -z "$$f" ]] || source "$$f" || exit 1; done; set +a; \
		timeout 60m npx playwright test || echo "Playwright exited non-zero (some tests failed); continuing to publish."

catalog:
	@echo "===== catalog ====="
	@if [[ ! -f report.json ]]; then \
		echo "No report.json — Playwright may have crashed before producing one." >&2; \
		exit 6; \
	fi
	@set -a; [[ -z "$(ENV_PROFILE)" ]] || source "$(ENV_PROFILE)"; set +a; \
		env BRANCH=$(BRANCH) GIT_SHA="$$(cat .git-sha 2>/dev/null || echo '')" RUN_LIMIT=$(RUN_LIMIT) \
		npx tsx scripts/build-catalog.ts "$(RUN_ID)"

publish:
	@echo "===== publish ====="
	@HOST_SSH=$(HOST_SSH) HOST_DIR=$(HOST_DIR) RUN_LIMIT=$(RUN_LIMIT) bash scripts/publish.sh "$(RUN_ID)"

catalog-only:
	@LATEST_RUN_ID=$$(ls -t test-results 2>/dev/null | head -1 || date -u +ad-hoc-%H%M); \
		set -a; [[ -z "$(ENV_PROFILE)" ]] || source "$(ENV_PROFILE)"; set +a; \
		env BRANCH=$(BRANCH) GIT_SHA="$$(git rev-parse --short HEAD)" RUN_LIMIT=$(RUN_LIMIT) \
		npx tsx scripts/build-catalog.ts "$$LATEST_RUN_ID"

publish-only:
	@HOST_SSH=$(HOST_SSH) HOST_DIR=$(HOST_DIR) RUN_LIMIT=$(RUN_LIMIT) bash scripts/publish.sh "$(RUN_ID)"
