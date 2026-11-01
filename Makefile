.DEFAULT_GOAL := help
SHELL := /bin/bash

PY  := uv run
SRC := src/jarvis
WEB := web

.PHONY: help
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

# --- setup -------------------------------------------------------------------

.PHONY: install dev web-install
install: ## Install the package
	uv pip install -e .

dev: ## Install with dev and all optional dependencies
	uv venv --python 3.12
	uv pip install -e ".[dev,postgres,redis,k8s]"

# The lock pins Quaerium from PyPI (what CI and the image use). To work on both
# at once, install the sibling checkout over it. `uv sync` / `uv run` would put
# the PyPI version back, so run the targets with UV_NO_SYNC=1 afterwards:
#   make quaerium-dev && UV_NO_SYNC=1 make check
QUAERIUM ?= ../Quaerium

.PHONY: quaerium-dev
quaerium-dev: ## Use the editable Quaerium checkout at ../Quaerium (then UV_NO_SYNC=1 make ...)
	uv pip install -e "$(QUAERIUM)[agents,server,agents-postgres,agents-redis]"

web-install: ## Install dashboard dependencies
	cd $(WEB) && npm install

setup: dev web-install ## Everything needed to work on Jarvis
	@test -f .env || cp .env.example .env
	@echo "Ready. Edit .env, then: make run"

# --- running -----------------------------------------------------------------

.PHONY: run run-api run-web
run-api: ## Backend on :8100, reloading
	$(PY) uvicorn jarvis.api.app:app --reload --port 8100

run-web: ## Dashboard on :5173, proxying /api to :8100
	cd $(WEB) && npm run dev

run: ## Build the dashboard and serve everything from :8100
	cd $(WEB) && npm run build
	$(PY) uvicorn jarvis.api.app:app --port 8100

.PHONY: port-forward
port-forward: ## Forward Prometheus :9090, Alertmanager :9093, Loki :3100 from the cluster
	@trap 'kill $$(jobs -p) 2>/dev/null' EXIT; \
	  kubectl -n monitoring port-forward svc/kube-prometheus-stack-prometheus 9090 & \
	  kubectl -n monitoring port-forward svc/kube-prometheus-stack-alertmanager 9093 & \
	  kubectl -n monitoring port-forward svc/loki 3100 & \
	  wait -n; echo "A port-forward exited; stopping the others. Run make port-forward again."

# --- quality -----------------------------------------------------------------

.PHONY: lint format format-check typecheck test test-cov web-typecheck web-lint check
lint: ## Lint
	$(PY) ruff check $(SRC) tests scripts

format: ## Format
	$(PY) black $(SRC) tests scripts
	$(PY) isort $(SRC) tests scripts

format-check: ## Verify formatting
	$(PY) black --check $(SRC) tests scripts
	$(PY) isort --check-only $(SRC) tests scripts

typecheck: ## Type-check the backend
	$(PY) mypy $(SRC)

web-typecheck: ## Type-check the dashboard
	cd $(WEB) && npm run typecheck

web-lint: ## Lint the dashboard (hooks rules: stale closures are bugs tsc cannot see)
	cd $(WEB) && npm run lint

test: ## Run the tests
	$(PY) pytest -q

test-cov: ## Run the tests with coverage
	$(PY) pytest --cov=jarvis --cov-report=term-missing --cov-report=html

check: format-check lint typecheck test ## Everything CI runs

# --- the cross-language check ------------------------------------------------

.PHONY: smoke-web
smoke-web: ## Run the browser's SSE client against a live backend
	@$(PY) uvicorn scripts.scripted_backend:app --port 8101 --log-level error & \
	  echo $$! > .smoke.pid; \
	  for i in $$(seq 30); do curl -sf localhost:8101/health >/dev/null && break; sleep 0.3; done; \
	  cd $(WEB) && npx esbuild ../scripts/smoke_web.ts --bundle --platform=node --format=esm \
	    --outfile=/tmp/jarvis-smoke.mjs --log-level=error && node /tmp/jarvis-smoke.mjs; \
	  status=$$?; kill $$(cat ../.smoke.pid) 2>/dev/null; rm -f ../.smoke.pid; exit $$status

# --- docker ------------------------------------------------------------------

.PHONY: up down logs ps rebuild
up: ## Start the stack; dashboard on http://localhost:8080
	docker compose up -d --build
	@echo "Dashboard: http://localhost:8080"

down: ## Stop the stack
	docker compose down

logs: ## Follow the backend log
	docker compose logs -f backend

ps: ## Show container status
	docker compose ps

rebuild: ## Rebuild images from scratch
	docker compose build --no-cache

# --- housekeeping ------------------------------------------------------------

.PHONY: clean
clean: ## Remove build and cache artefacts
	rm -rf build/ dist/ *.egg-info .pytest_cache/ .mypy_cache/ .ruff_cache/ htmlcov/ .coverage $(WEB)/dist
	find . -type d -name __pycache__ -not -path './.venv/*' -exec rm -rf {} + 2>/dev/null || true
