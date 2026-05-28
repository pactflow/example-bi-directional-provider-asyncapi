# Example: Bi-Directional Contract Testing with AsyncAPI

> **Early access demo** — PactFlow's AsyncAPI support for bi-directional contract
> testing is not yet publicly available. This demo shows how it works.

## What is this?

This repository demonstrates how to write **Pact consumer tests for a
message-based service** and verify the provider contract using **PactFlow's
AsyncAPI bi-directional contract testing (BDCT)** feature.

Instead of running the provider application, BDCT compares the generated Pact
file against the provider's **AsyncAPI document**.

### Two messaging patterns are demonstrated

| Pattern | AsyncAPI action | Pact interaction type |
|---|---|---|
| **Fire-and-forget** | `receive` | `Asynchronous/Messages` |
| **Request/Reply** | `send` + `reply` | `Synchronous/Messages` |

---

## Project layout

```
.
├── src/
│   ├── consumer.ts          # User Service event handlers (consumer code)
│   └── consumer.test.ts     # Pact V4 consumer tests
├── provider/
│   └── asyncapi.yaml        # AsyncAPI 3.1.0 document (provider contract)
├── scripts/
│   └── verify-provider.mjs  # Runs the comparator against pacts + AsyncAPI doc
├── pacts/                   # Generated Pact files (git-ignored)
├── package.json
└── vitest.config.ts
```

---

## Quick start

> **Pre-release dependency** — AsyncAPI support in `@pactflow/openapi-pact-comparator`
> is not yet published to npm. `package.json` references the GitHub main branch.

```bash
# Install dependencies (includes the pre-release comparator from GitHub)
npm install

# Step 1 — run consumer tests → generates ./pacts/UserServiceConsumer-UserService.json
npm run test:consumer

# Step 2 — verify the Pact file against the AsyncAPI document
npm run verify:provider

# OR, run both sequentially with...
# npm t
```

---

## How it works

### Consumer side

The consumer tests (`src/consumer.test.ts`) use **Pact V4** (`@pact-foundation/pact`)
to describe the messages the consumer expects.  Each interaction is linked to
the relevant **AsyncAPI operation** via the `.reference()` call:

```ts
pact
  .addAsynchronousInteraction()
  .reference('AsyncAPI', 'operationId', 'receiveUserEvents')
  .expectsToReceive('a user-created event', (builder) => {
    builder.withJSONContent({ userId: string('u-abc-123'), email: string('...') });
  })
  .executeTest(v4SynchronousBodyHandler(handleUserCreated));
```

Running the tests writes a Pact file to `./pacts/` with a `comments.references`
block that the comparator uses to look up the correct AsyncAPI operation:

```json
{
  "comments": {
    "references": {
      "AsyncAPI": {
        "operationId": "receiveUserEvents",
      }
    }
  }
}
```

### Provider side

The provider only needs to publish its **AsyncAPI document**
(`provider/asyncapi.yaml`).  No code runs.  The comparator checks that every
interaction in the Pact file is compatible with the schema defined in the spec.

```bash
npm run verify:provider
```

This calls `@pactflow/openapi-pact-comparator` programmatically against:
- `provider/asyncapi.yaml` — the provider's AsyncAPI spec
- `pacts/UserServiceConsumer-UserService.json` — the generated consumer contract

---

## AsyncAPI document overview

The `provider/asyncapi.yaml` defines:

- **`userEvents` channel** (`user-events`) — carries `userCreated` and
  `userDeleted` events consumed by downstream services.
- **`getUserRequests` / `getUserResponses` channels** — used for synchronous
  user lookup via request/reply (AsyncAPI 3.x `reply` block).

### Operations

```
receiveUserEvents   action: receive   → fire-and-forget events
getUser             action: send      → request/reply lookup
```