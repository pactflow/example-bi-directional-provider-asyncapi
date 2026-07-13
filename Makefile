PACTICIPANT := pactflow-example-bi-directional-provider-asyncapi
CONSUMER := pactflow-example-bi-directional-provider-asyncapi-consumer
GITHUB_REPO := pactflow/example-bi-directional-provider-asyncapi
PACT_CLI := npx --yes @pact-foundation/pact-cli@latest
OAS_PATH := provider/asyncapi.yaml
GIT_COMMIT ?= $(shell git rev-parse --short HEAD)
GIT_BRANCH ?= $(shell git rev-parse --abbrev-ref HEAD)

ifeq ($(GIT_BRANCH),main)
	DEPLOY_TARGET=deploy
else
	DEPLOY_TARGET=no_deploy
endif

all: test

install:
	npm install

test:
	npm run test:consumer

test_and_publish: test publish_pact publish_provider_contract

ci: test publish_pact publish_provider_contract can_i_deploy $(DEPLOY_TARGET)

fake_ci:
	GIT_COMMIT=`git rev-parse --short HEAD`+`date +%s` \
	GIT_BRANCH=`git rev-parse --abbrev-ref HEAD` \
	make ci

publish_pact:
	@echo "\n========== STAGE: publish consumer pact ==========\n"
	pact broker publish ./pacts \
	  --consumer-app-version ${GIT_COMMIT} \
	  --branch ${GIT_BRANCH}

publish_provider_contract:
	@echo "\n========== STAGE: publish provider contract (AsyncAPI) ==========\n"
	pact pactflow publish-provider-contract ${OAS_PATH} \
	  --provider ${PACTICIPANT} \
	  --provider-app-version ${GIT_COMMIT} \
	  --branch ${GIT_BRANCH} \
	  --content-type application/yaml \
		--specification asyncapi \
		--verification-success \
		--verification-results ./results.txt \
		--verification-results-content-type text/plain

can_i_deploy:
	@echo "\n========== STAGE: can-i-deploy? ==========\n"
	pact broker can-i-deploy \
	  --pacticipant ${PACTICIPANT} \
	  --version ${GIT_COMMIT} \
	  --to-environment production \
	  --retry-while-unknown 6 \
	  --retry-interval 10

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

.PHONY: all install test ci test_and_publish fake_ci publish_pact publish_provider_contract \
  can_i_deploy deploy no_deploy deploy_app record_deployment
