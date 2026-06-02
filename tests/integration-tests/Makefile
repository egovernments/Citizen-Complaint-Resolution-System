# Test catalog dashboard — runner targets
#
# Usage:
#   make test-and-publish              # run main, publish to Nairobi
#   BRANCH=feature/foo make test-and-publish
#   make catalog-only                  # rebuild catalog from current report.json without re-running
#   make publish-only                  # publish current artifacts without re-running

SHELL := /usr/bin/env bash

BRANCH ?= main
BASE_URL ?= https://naipepea.digit.org
DIGIT_TENANT ?= ke.nairobi
LOCALITY_CODE ?= NAIROBI_CITY_VIWANDANI
HOST_SSH ?= egov-nairobi
HOST_DIR ?= /var/www/tests
LOCK := /tmp/digit-tests.lock

# Run-id format: 2026-05-07_1430_a1b2c3d
RUN_ID := $(shell date -u +%Y-%m-%d_%H%M)_$(shell git rev-parse --short HEAD 2>/dev/null || echo unknown)

.PHONY: test-and-publish run catalog publish prepare fetch-history

test-and-publish:
	@flock -n $(LOCK) -c '$(MAKE) _do-cycle' || (echo "Another run is already in progress; exiting." >&2; exit 1)

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
	-@timeout 60m env BASE_URL=$(BASE_URL) DIGIT_TENANT=$(DIGIT_TENANT) LOCALITY_CODE=$(LOCALITY_CODE) \
		npx playwright test || echo "Playwright exited non-zero (some tests failed); continuing to publish."

catalog:
	@echo "===== catalog ====="
	@if [[ ! -f report.json ]]; then \
		echo "No report.json — Playwright may have crashed before producing one." >&2; \
		exit 6; \
	fi
	@env BRANCH=$(BRANCH) BASE_URL=$(BASE_URL) GIT_SHA="$$(cat .git-sha 2>/dev/null || echo '')" \
		npx tsx scripts/build-catalog.ts "$(RUN_ID)"

publish:
	@echo "===== publish ====="
	@HOST_SSH=$(HOST_SSH) HOST_DIR=$(HOST_DIR) bash scripts/publish.sh "$(RUN_ID)"

catalog-only:
	@LATEST_RUN_ID=$$(ls -t test-results 2>/dev/null | head -1 || date -u +ad-hoc-%H%M); \
		env BRANCH=$(BRANCH) BASE_URL=$(BASE_URL) GIT_SHA="$$(git rev-parse --short HEAD)" \
		npx tsx scripts/build-catalog.ts "$$LATEST_RUN_ID"

publish-only:
	@HOST_SSH=$(HOST_SSH) HOST_DIR=$(HOST_DIR) bash scripts/publish.sh "$(RUN_ID)"
