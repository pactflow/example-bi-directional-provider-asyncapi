# Optional local settings (PACT_BROKER_BASE_URL, PACT_BROKER_TOKEN) — see .env.example
-include .env
export

PACTICIPANT := pactflow-example-bi-directional-provider-asyncapi
CONSUMER := pactflow-example-bi-directional-provider-asyncapi-consumer
GITHUB_REPO := pactflow/example-bi-directional-provider-asyncapi
ASYNCAPI_PATH := provider/asyncapi.yaml
DRIFT_TEST_FILE := drift/user-service.drift.yaml
OUTPUT_DIR := output
PROVIDER_HEALTH_URL := http://localhost:8081/health
GIT_COMMIT ?= $(shell git rev-parse --short HEAD)
GIT_BRANCH ?= $(shell git rev-parse --abbrev-ref HEAD)
export PATH := node_modules/.bin:$(PATH)
export KAFKAJS_NO_PARTITIONER_WARNING := 1

ifeq ($(GIT_BRANCH),main)
	DEPLOY_TARGET=deploy
else
	DEPLOY_TARGET=no_deploy
endif

all: test

install:
	npm install

## ====================
## Consumer
## ====================

test:
	npm run test:consumer

publish_pact:
	@echo "\n========== STAGE: publish consumer pact ==========\n"
	pact broker publish ./pacts \
	  --consumer-app-version ${GIT_COMMIT} \
	  --branch ${GIT_BRANCH}

## ====================
## Provider (Drift + Kafka)
## ====================

# Start a local Kafka broker in Docker and wait until it is healthy
kafka_up:
	docker compose up -d --wait

# Stop the broker and throw away its data
kafka_down:
	docker compose down -v

# Start the provider, verify it against the AsyncAPI document with Drift, then
# stop it again. Requires Kafka (make kafka_up) and a Drift-enabled PactFlow
# login (drift auth login). Exits with Drift's exit code.
test_provider: clean
	@echo "\n========== STAGE: verify provider with Drift ==========\n"
	@node src/provider/server.ts > ${OUTPUT_DIR}/provider.log 2>&1 & PROVIDER_PID=$$!; \
	trap "kill $$PROVIDER_PID 2>/dev/null" EXIT; \
	node scripts/wait-for-health.ts ${PROVIDER_HEALTH_URL} 60000 || { cat ${OUTPUT_DIR}/provider.log; exit 1; }; \
	drift verify \
	  --test-files ${DRIFT_TEST_FILE} \
	  --output-dir ${OUTPUT_DIR} \
	  --generate-result

publish_provider_contract:
	@echo "\n========== STAGE: publish provider contract (AsyncAPI + Drift results) ==========\n"
	pact pactflow publish-provider-contract ${ASYNCAPI_PATH} \
	  --provider ${PACTICIPANT} \
	  --provider-app-version ${GIT_COMMIT} \
	  --branch ${GIT_BRANCH} \
	  --content-type application/yaml \
	  --specification asyncapi \
	  --verification-exit-code=${EXIT_CODE} \
	  --verification-results "$(shell find ${OUTPUT_DIR} -name 'verification.*.result' -type f | head -1)" \
	  --verification-results-content-type application/vnd.smartbear.drift.result \
	  --verifier drift \
	  --verifier-version $(shell drift --version)

## ====================
## CI
## ====================

# Run the consumer tests and publish the pact, then verify the provider with
# Drift and publish the AsyncAPI document along with the Drift results — whether
# Drift passed or failed, so PactFlow always knows the provider's status.
test_and_publish: test publish_pact kafka_up
	@if make test_provider; then \
		EXIT_CODE=0 make publish_provider_contract; \
	else \
		EXIT_CODE=1 make publish_provider_contract; \
	fi

ci: test_and_publish can_i_deploy $(DEPLOY_TARGET)

# Run the ci target from a developer machine with the environment variables
# set as if it was on GitHub Actions.
fake_ci:
	GIT_COMMIT=`git rev-parse --short HEAD`+`date +%s` \
	GIT_BRANCH=`git rev-parse --abbrev-ref HEAD` \
	make ci

can_i_deploy:
	@echo "\n========== STAGE: can-i-deploy? ==========\n"
	pact broker can-i-deploy \
	  --pacticipant ${PACTICIPANT} \
	  --version ${GIT_COMMIT} \
	  --to-environment production \
	  --retry-while-unknown 6 \
	  --retry-interval 10

## ====================
## Deploy
## ====================

deploy: deploy_app record_deployment

no_deploy:
	@echo "Not deploying as not on main branch"

deploy_app:
	@echo "Deploying to production"

record_deployment:
	pact broker record-deployment \
	  --pacticipant ${PACTICIPANT} \
	  --version ${GIT_COMMIT} \
	  --environment production

## ====================
## Misc
## ====================

clean:
	mkdir -p ${OUTPUT_DIR} && rm -rf ${OUTPUT_DIR}/*

.PHONY: all install test publish_pact kafka_up kafka_down test_provider publish_provider_contract \
  test_and_publish ci fake_ci can_i_deploy deploy no_deploy deploy_app record_deployment clean
