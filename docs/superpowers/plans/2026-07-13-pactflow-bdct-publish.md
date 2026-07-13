# PactFlow BDCT Publish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace this repo's local `@pactflow/openapi-pact-comparator` verification with a Makefile-driven pipeline that publishes the consumer pact and the provider's AsyncAPI contract to PactFlow, gated by `can-i-deploy`, matching the pattern used in `example-bi-directional-provider-postman` and `example-bi-directional-provider-drift`.

**Architecture:** No new runtime code. This is a tooling/config refactor: drop a dependency and a script, rename two string identifiers, add a `Makefile` that shells out to `npx @pact-foundation/pact-cli`, add a GitHub Actions workflow that calls the Makefile, and update docs to match.

**Tech Stack:** Node/TypeScript, Vitest, `@pact-foundation/pact` (consumer test library, unchanged), `@pact-foundation/pact-cli` (new — provides `pact-broker`/`pactflow` CLIs via npx), GNU Make, GitHub Actions.

## Global Constraints

- Provider pacticipant name: `pactflow-example-bi-directional-provider-asyncapi` (spec §Pacticipant naming)
- Consumer pacticipant name: `pactflow-example-bi-directional-provider-asyncapi-consumer` (spec §Pacticipant naming)
- No `--verifier` / `--verification-results` / `--verification-exit-code` flags on `publish-provider-contract` — PactFlow performs the BDCT comparison server-side once both contracts are published (spec §Design, key difference note)
- `PACT_CLI := npx --yes @pact-foundation/pact-cli@latest` — no Docker dependency (spec §Dependencies)
- AsyncAPI contract content type on publish: `application/yaml` (spec §Makefile)
- `can-i-deploy` and `record-deployment` target the **provider** pacticipant against the `production` environment (spec §Makefile)
- Deploy only from the `main` branch (spec §Makefile `ifeq ($(GIT_BRANCH),main)`)
- `PACT_BROKER_BASE_URL` (repo variable) / `PACT_BROKER_TOKEN` (repo secret) are read from the environment, never hardcoded (spec §CI workflow)

---

## File Structure

| File | Change |
|---|---|
| `package.json` | remove `@pactflow/openapi-pact-comparator`, `js-yaml`, `@types/js-yaml`; add `@pact-foundation/pact-cli`; simplify `scripts` |
| `src/consumer.test.ts` | rename `consumer`/`provider` strings passed to `new Pact({...})` |
| `scripts/verify-provider.mjs` | delete |
| `Makefile` | new — install/test/publish/can-i-deploy/deploy pipeline |
| `.github/workflows/build.yml` | new — CI wiring the Makefile |
| `README.md` | rewrite Quick start / How it works / provider section to describe the publish flow instead of the local comparator |

---

### Task 1: Rename pacticipants and re-point the dependency set in `package.json`

**Files:**
- Modify: `src/consumer.test.ts:41-46`
- Modify: `package.json`

**Interfaces:**
- Produces: pact file written to `./pacts/pactflow-example-bi-directional-provider-asyncapi-consumer-pactflow-example-bi-directional-provider-asyncapi.json` (Pact's default `<consumer>-<provider>.json` naming) — Task 3's Makefile `publish_pact` target reads every file in `./pacts/`, so the exact filename doesn't matter to later tasks, only that the directory contains the renamed pact.

- [ ] **Step 1: Update the pacticipant names in the consumer test**

Edit `src/consumer.test.ts`, replacing the `new Pact({...})` call:

```ts
  const pact = new Pact({
    consumer: 'pactflow-example-bi-directional-provider-asyncapi-consumer',
    provider: 'pactflow-example-bi-directional-provider-asyncapi',
    dir: path.resolve(process.cwd(), 'pacts'),
    logLevel: 'warn',
  });
```

- [ ] **Step 2: Clear out any stale pact file from the old names**

```bash
rm -f pacts/*.json
```

- [ ] **Step 3: Run the consumer tests and verify a pact is generated under the new names**

Run: `npm run test:consumer`
Expected: all tests pass (verbose reporter shows 3 passing tests), and:

```bash
ls pacts/
```

shows a file whose name contains both
`pactflow-example-bi-directional-provider-asyncapi-consumer` and
`pactflow-example-bi-directional-provider-asyncapi`.

- [ ] **Step 4: Update `package.json` dependencies**

Edit `package.json`. Replace the `devDependencies` block:

```json
  "devDependencies": {
    "@pact-foundation/pact": "^16.5.0",
    "@pact-foundation/pact-cli": "^18.1.1",
    "@types/node": "^22.0.0",
    "typescript": "^5.6.0",
    "vite": "^6.0.0",
    "vitest": "^2.1.0"
  }
```

(This drops `@pactflow/openapi-pact-comparator`, `@types/js-yaml`, and
`js-yaml` — none are referenced anywhere once Task 3 deletes
`scripts/verify-provider.mjs`.)

- [ ] **Step 5: Update `package.json` scripts**

Replace the `scripts` block:

```json
  "scripts": {
    "test:consumer": "vitest run --reporter=verbose"
  }
```

(Drops the combined `test` script and `verify:provider` — superseded by
the Makefile's `ci` target in Task 3.)

- [ ] **Step 6: Reinstall to update the lockfile**

Run: `npm install`
Expected: exits 0; `package-lock.json` no longer references
`@pactflow/openapi-pact-comparator` or `js-yaml`. Verify:

```bash
grep -c "openapi-pact-comparator" package-lock.json
```

Expected output: `0` (grep exits 1 on no match — that's fine).

- [ ] **Step 7: Re-run consumer tests against the updated toolchain**

Run: `npm run test:consumer`
Expected: same as Step 3 — all tests pass.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/consumer.test.ts pacts/
git commit -m "refactor: rename pacticipants and drop local comparator dependency"
```

---

### Task 2: Delete the local verification script

**Files:**
- Delete: `scripts/verify-provider.mjs`

**Interfaces:**
- Consumes: nothing (this is a pure deletion)
- Produces: nothing — later tasks (Makefile, CI, README) must not reference `scripts/verify-provider.mjs` or `verify:provider` anywhere

- [ ] **Step 1: Delete the script and its now-empty directory if applicable**

```bash
rm scripts/verify-provider.mjs
rmdir scripts 2>/dev/null || true
```

- [ ] **Step 2: Confirm no remaining references**

```bash
grep -rn "verify-provider\|verify:provider\|openapi-pact-comparator" --exclude-dir=node_modules --exclude-dir=.git .
```

Expected: no output (Task 1 already removed the `package.json`
references; this step is a repo-wide sanity check that also covers
`README.md`, which Task 5 will still be about to rewrite — if this grep
turns up hits in `README.md` at this point, that's expected and Task 5
resolves them).

- [ ] **Step 3: Commit**

```bash
git add -A scripts
git commit -m "chore: remove local BDCT comparator script"
```

---

### Task 3: Add the `Makefile`

**Files:**
- Create: `Makefile`

**Interfaces:**
- Consumes: `pacts/` directory (populated by `npm run test:consumer`, Task 1), `provider/asyncapi.yaml` (unchanged, pre-existing)
- Produces: make targets `install`, `test`, `ci`, `fake_ci`, `publish_pact`, `publish_provider_contract`, `can_i_deploy`, `deploy`, `no_deploy`, `deploy_app`, `record_deployment` — Task 4's GitHub Actions workflow invokes `make ci`, `make can_i_deploy`, and `make deploy` by name and relies on `GIT_COMMIT`/`GIT_BRANCH` being overridable via environment variables.

- [ ] **Step 1: Create the Makefile**

Create `Makefile`:

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

- [ ] **Step 2: Verify the Makefile parses and targets are listed correctly**

Run: `make -n test`
Expected: prints `npm run test:consumer` without executing it (dry run;
`-n` = don't actually run recipes). No Make syntax errors.

Run: `make -n ci`
Expected: dry-run prints the full sequence of commands for `test`,
`publish_pact`, `publish_provider_contract`, `can_i_deploy`, and either
`deploy` or `no_deploy` depending on the current branch — with no Make
errors (missing-target or syntax errors would abort the dry run
immediately).

- [ ] **Step 3: Run the local `test` target for real**

Run: `make test`
Expected: same output as `npm run test:consumer` — all tests pass.

- [ ] **Step 4: Commit**

```bash
git add Makefile
git commit -m "feat: add Makefile for PactFlow publish/can-i-deploy pipeline"
```

*(Note: `make publish_pact`, `make publish_provider_contract`,
`make can_i_deploy`, and `make deploy` require a real
`PACT_BROKER_BASE_URL`/`PACT_BROKER_TOKEN` pointed at a PactFlow instance
with AsyncAPI BDCT enabled — this plan does not run them against a live
broker; see the spec's Testing section.)*

---

### Task 4: Add the GitHub Actions workflow

**Files:**
- Create: `.github/workflows/build.yml`

**Interfaces:**
- Consumes: `make ci`, `make can_i_deploy`, `make deploy` (Task 3)
- Produces: nothing consumed by later tasks — this is the last functional piece; Task 5 only documents it

- [ ] **Step 1: Create the workflow directory and file**

Create `.github/workflows/build.yml`:

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

- [ ] **Step 2: Validate YAML syntax**

Run: `python3 -c "import yaml, sys; yaml.safe_load(open('.github/workflows/build.yml'))" && echo VALID`
Expected output: `VALID`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/build.yml
git commit -m "ci: add build workflow publishing contracts to PactFlow"
```

---

### Task 5: Update the README

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: pacticipant names from Task 1, Makefile targets from Task 3, workflow from Task 4
- Produces: nothing — terminal documentation task

- [ ] **Step 1: Replace the early-access banner and intro**

In `README.md`, replace lines 1–21 (title through the pattern table) with:

```markdown
# Example: Bi-Directional Contract Testing with AsyncAPI

## What is this?

This repository demonstrates how to write **Pact consumer tests for a
message-based service** and verify the provider contract using **PactFlow's
AsyncAPI bi-directional contract testing (BDCT)** feature.

The consumer pact and the provider's **AsyncAPI document** are both
published to PactFlow. PactFlow compares them server-side — no provider
code needs to run, and no local comparison tooling is required.

This repo currently holds both the consumer and provider side of the
example in one place. It will eventually be split into standalone
consumer/provider repos, closer in shape to
[`example-bi-directional-provider-postman`](https://github.com/pactflow/example-bi-directional-provider-postman)
and
[`example-bi-directional-provider-drift`](https://github.com/pactflow/example-bi-directional-provider-drift)
(the latter once Drift is used to verify the AsyncAPI provider directly).

### Two messaging patterns are demonstrated

| Pattern | AsyncAPI action | Pact interaction type |
|---|---|---|
| **Fire-and-forget** | `receive` | `Asynchronous/Messages` |
| **Request/Reply** | `send` + `reply` | `Synchronous/Messages` |
```

- [ ] **Step 2: Update the project layout section**

Replace the "Project layout" code block (originally lines 24–38) — remove
the `scripts/` entry and add `Makefile`:

```markdown
## Project layout

```
.
├── src/
│   ├── consumer.ts          # User Service event handlers (consumer code)
│   └── consumer.test.ts     # Pact V4 consumer tests
├── provider/
│   └── asyncapi.yaml        # AsyncAPI 3.1.0 document (provider contract)
├── pacts/                   # Generated Pact files (git-ignored)
├── Makefile                 # install / test / publish / can-i-deploy / deploy
├── .github/workflows/       # CI: test → publish → can-i-deploy → deploy
├── package.json
└── vitest.config.ts
```
```

- [ ] **Step 3: Replace the Quick start section**

Replace the "Quick start" section (originally lines 42–59) with:

```markdown
## Quick start

```bash
# Install dependencies
npm install

# Step 1 — run consumer tests → generates ./pacts/*.json
npm run test:consumer

# Step 2 — publish the consumer pact and the provider's AsyncAPI contract
# to PactFlow, then check can-i-deploy
export PACT_BROKER_BASE_URL=https://your-instance.pactflow.io
export PACT_BROKER_TOKEN=your-token
make ci

# OR run individual stages
make test                       # steps 1
make publish_pact                # publish the consumer pact
make publish_provider_contract   # publish the provider's AsyncAPI doc
make can_i_deploy                # gate a deployment
```
```

- [ ] **Step 4: Replace the "How it works" provider section**

Replace the "Provider side" subsection (originally lines 96–109) with:

```markdown
### Provider side

The provider publishes its **AsyncAPI document**
(`provider/asyncapi.yaml`) to PactFlow as its provider contract. No
provider code runs. PactFlow checks that every interaction in the
published consumer pact is compatible with the schema defined in the
spec, then reports the result via `can-i-deploy`.

```bash
make publish_provider_contract
make can_i_deploy
```

This runs, via `npx @pact-foundation/pact-cli`:

- `pactflow publish-provider-contract provider/asyncapi.yaml --provider
  pactflow-example-bi-directional-provider-asyncapi ...` — uploads the
  spec and lets PactFlow perform the BDCT comparison against previously
  published consumer pacts.
- `pact-broker can-i-deploy --pacticipant
  pactflow-example-bi-directional-provider-asyncapi ...` — checks whether
  the current provider version is safe to deploy to `production`.
```
```

- [ ] **Step 5: Confirm no remaining references to the removed comparator**

```bash
grep -n "verify-provider\|verify:provider\|openapi-pact-comparator\|early access" README.md
```

Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs: describe PactFlow publish/can-i-deploy flow"
```

---

## Self-Review Notes

- **Spec coverage:** dependency removal/addition (Task 1), pacticipant
  rename (Task 1), script deletion (Task 2), Makefile with all targets from
  the spec including the no-verifier-flags constraint (Task 3), CI workflow
  matching the 3-job shape (Task 4), README rewrite including the
  future-split note (Task 5) — all spec sections covered. The spec's
  "Testing" section note about needing real broker credentials is called
  out explicitly in Task 3 rather than silently skipped.
- **Placeholder scan:** no TBD/TODO; every step has literal file content or
  an exact command with expected output.
- **Type/name consistency:** `PACTICIPANT`/`CONSUMER` pacticipant strings
  match exactly between Task 1 (`consumer.test.ts`) and Task 3 (`Makefile`)
  and Task 5 (README); Makefile target names (`ci`, `can_i_deploy`,
  `deploy`) are identical between Task 3 and Task 4's workflow.
