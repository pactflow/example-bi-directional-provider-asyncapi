# Design: Publish AsyncAPI BDCT contracts to PactFlow

**Date:** 2026-07-13
**Branch:** `feature/pactflow-bdct-publish`

## Context

This repo demonstrates Pact bi-directional contract testing (BDCT) for a
message-based service, using PactFlow's early-access AsyncAPI support. Until
now, verification was done **locally** by running
`@pactflow/openapi-pact-comparator` against the generated consumer pact and
the provider's `asyncapi.yaml` (`scripts/verify-provider.mjs`).

The AsyncAPI BDCT feature is now live in PactFlow. This means the comparison
can happen server-side: publish the consumer pact and the provider's AsyncAPI
document to PactFlow, and use `can-i-deploy` to gate deployment — the same
pattern already used in the sibling repos
[`example-bi-directional-provider-postman`](https://github.com/pactflow/example-bi-directional-provider-postman)
and
[`example-bi-directional-provider-drift`](https://github.com/pactflow/example-bi-directional-provider-drift).

This repo will eventually be split into standalone consumer/provider repos
(closer in shape to the drift example, once Drift itself is used to test the
AsyncAPI provider). That split is **out of scope** for this change — both
consumer and provider concerns stay in this one repo for now, driven by a
single Makefile.

## Goals

- Remove the local `@pactflow/openapi-pact-comparator` dependency and script.
- Publish the consumer pact to PactFlow (`pact-broker publish`).
- Publish the provider's AsyncAPI document to PactFlow as the provider
  contract (`pactflow publish-provider-contract`), letting PactFlow perform
  the BDCT comparison server-side.
- Gate deployment with `can-i-deploy`.
- Restructure build/publish/deploy orchestration into a `Makefile`, matching
  the postman/drift examples.
- Add a GitHub Actions workflow mirroring the postman/drift CI shape.

## Non-goals

- Splitting into separate consumer/provider repos.
- Adding Drift verification of the provider.
- Configuring the actual PactFlow broker URL/token secrets in GitHub (left as
  a documented setup step — I can't create repo secrets/vars myself).

## Design

### Pacticipant naming

Renamed in `src/consumer.test.ts` to match sibling-repo convention (repo name
= provider pacticipant name):

- Provider: `pactflow-example-bi-directional-provider-asyncapi`
- Consumer: `pactflow-example-bi-directional-provider-asyncapi-consumer`

### Dependencies

- **Remove:** `@pactflow/openapi-pact-comparator`, `js-yaml`,
  `@types/js-yaml`.
- **Add:** `@pact-foundation/pact-cli` (devDependency) — provides `pact` /
  `pact-broker` / `pactflow` binaries via `npx`, avoiding a Docker dependency
  and staying consistent with this project's Node-native tooling (unlike
  drift/postman, which use Docker or standalone binaries).

### Files removed

- `scripts/verify-provider.mjs`

### `Makefile` (new)

Modeled on `example-bi-directional-provider-drift`'s Makefile, adapted to use
`npx` instead of Docker:

```makefile
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

ci: test publish_pact publish_provider_contract can_i_deploy $(DEPLOY_TARGET)

fake_ci:
	GIT_COMMIT=`git rev-parse --short HEAD`+`date +%s` \
	GIT_BRANCH=`git rev-parse --abbrev-ref HEAD` \
	make ci

publish_pact:
	@echo "\n========== STAGE: publish consumer pact ==========\n"
	${PACT_CLI} pact-broker publish ./pacts \
	  --consumer-app-version ${GIT_COMMIT} \
	  --branch ${GIT_BRANCH}

publish_provider_contract:
	@echo "\n========== STAGE: publish provider contract (AsyncAPI) ==========\n"
	${PACT_CLI} pactflow publish-provider-contract ${OAS_PATH} \
	  --provider ${PACTICIPANT} \
	  --provider-app-version ${GIT_COMMIT} \
	  --branch ${GIT_BRANCH} \
	  --content-type application/yaml

can_i_deploy:
	@echo "\n========== STAGE: can-i-deploy? ==========\n"
	${PACT_CLI} pact-broker can-i-deploy \
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
	${PACT_CLI} pact-broker record-deployment \
	  --pacticipant ${PACTICIPANT} \
	  --version ${GIT_COMMIT} \
	  --environment production

.PHONY: all install test ci fake_ci publish_pact publish_provider_contract \
  can_i_deploy deploy no_deploy deploy_app record_deployment
```

Key difference from postman/drift: because there's no local verifier tool
producing pass/fail results, `publish_provider_contract` has no
`--verification-exit-code` / `--verification-results` / `--verifier` flags —
publishing the spec **is** the action; PactFlow performs the BDCT comparison
after both the consumer pact and provider contract exist for a given
version. `ci` is therefore a straight pipeline rather than postman/drift's
conditional-exit-code dance around `test`.

### `package.json`

- Scripts: keep `test:consumer` (`vitest run --reporter=verbose`), remove
  `verify:provider` and the combined `test` script (superseded by
  `make ci`).
- Dependencies updated per above.

### `.github/workflows/build.yml` (new)

Three jobs, mirroring the postman/drift shape:

```yaml
name: Build

on:
  push:
  workflow_dispatch:

env:
  PACT_BROKER_BASE_URL: ${{ vars.PACT_BROKER_BASE_URL }}
  PACT_BROKER_TOKEN: ${{ secrets.PACT_BROKER_TOKEN }}
  GIT_COMMIT: ${{ github.sha }}
  GITHUB_REF: ${{ github.ref }}

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: '22'
      - run: npm ci
      - run: GIT_BRANCH=${GITHUB_REF:11} make ci

  can-i-deploy:
    runs-on: ubuntu-latest
    needs: test
    steps:
      - uses: actions/checkout@v6
      - run: GIT_BRANCH=${GITHUB_REF:11} make can_i_deploy

  deploy:
    runs-on: ubuntu-latest
    needs: can-i-deploy
    steps:
      - uses: actions/checkout@v6
      - run: GIT_BRANCH=${GITHUB_REF:11} make deploy
        if: github.ref == 'refs/heads/main'
```

Requires `PACT_BROKER_BASE_URL` (repo variable) and `PACT_BROKER_TOKEN`
(repo secret) to be configured in GitHub — noted as a setup step in the
README since I can't create these myself.

### README

- Drop the "early access demo" / local-comparator framing.
- Describe the new flow: run consumer tests → `make ci` publishes the
  consumer pact and the provider's AsyncAPI doc to PactFlow → PactFlow
  performs BDCT comparison → `can-i-deploy` gates deployment.
- Keep the existing "How it works" / operations / mermaid diagram content —
  it still accurately describes the consumer/provider contract shape.
- Add a short note that this repo will eventually split into standalone
  consumer/provider repos (linking the postman/drift examples as the target
  shape), matching the user's stated direction.

## Testing

- `npm run test:consumer` still generates a valid pact file.
- `make ci` runs end-to-end against a real PactFlow instance (manual
  verification once broker credentials are available — not automatable in
  this session without credentials).
- Confirm `scripts/verify-provider.mjs` and its dependencies are fully
  removed with no dangling references (README, package.json).
