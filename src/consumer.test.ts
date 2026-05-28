/**
 * Pact consumer tests for the User Service messaging contract.
 *
 * These tests generate a Pact file that describes the messages this consumer
 * expects to receive from the User Service provider. In bi-directional contract
 * testing the provider side is verified by comparing the Pact file against the
 * provider's AsyncAPI document — no provider code needs to run.
 *
 * Two interaction styles are demonstrated:
 *
 *   1. Fire-and-forget (Asynchronous/Messages)
 *      The provider publishes an event; the consumer handles it.
 *      AsyncAPI operation action: "receive"
 *
 *   2. Request/Reply (Synchronous/Messages)
 *      The consumer sends a request and awaits a correlated reply.
 *      AsyncAPI operation action: "send" with a "reply" block
 *
 * The `.reference('AsyncAPI', 'operationId', '...')` call links each
 * interaction to the corresponding AsyncAPI operation so PactFlow's comparator
 * knows which part of the spec to validate against.
 */

import path from 'node:path';
import { Matchers, Pact, v4SynchronousBodyHandler } from '@pact-foundation/pact';
import { describe, it } from 'vitest';
import {
  handleUserCreated,
  handleUserDeleted,
  handleGetUserResponse,
  type UserCreatedEvent,
  type UserDeletedEvent,
  type GetUserResponse,
} from './consumer.js';

const { string } = Matchers;

describe('User Service Consumer', () => {
  // Pact (aliased from PactV4) — no mock HTTP server; messages are exchanged
  // in-process through the Pact Rust core FFI.
  const pact = new Pact({
    consumer: 'UserServiceConsumer',
    provider: 'UserService',
    dir: path.resolve(process.cwd(), 'pacts'),
    logLevel: 'warn',
  });

  // ---------------------------------------------------------------------------
  // 1. Fire-and-forget — Asynchronous/Messages
  //    The consumer subscribes to the "user-events" channel and handles events
  //    published by the provider.  Each interaction corresponds to one message
  //    type within the "receiveUserEvents" AsyncAPI operation.
  // ---------------------------------------------------------------------------

  describe('Fire-and-forget: receiveUserEvents operation', () => {
    it('handles a userCreated event', () => {
      return pact
        .addAsynchronousInteraction()
        // Link this interaction to the AsyncAPI operation and message.
        // The comparator uses these references to locate the correct schema.
        // If the body matches _any_ of the messages on the operation, it is considered a match
        .reference('AsyncAPI', 'operationId', 'receiveUserEvents')
        .expectsToReceive('a user-created event', (builder) => {
          builder.withJSONContent({
            // string() matcher: value must be a string (exact value not required)
            userId: string('u-abc-123'),
            email: string('user@example.com'),
          });
        })
        // v4SynchronousBodyHandler extracts the message body and passes it
        // directly to the handler — the test passes if the handler does not throw.
        .executeTest(
          v4SynchronousBodyHandler((body: unknown) => {
            handleUserCreated(body as UserCreatedEvent);
          }),
        );
    });

    it('handles a userDeleted event', () => {
      return pact
        .addAsynchronousInteraction()
        .reference('AsyncAPI', 'operationId', 'receiveUserEvents')
        .expectsToReceive('a user-deleted event', (builder) => {
          builder.withJSONContent({
            userId: string('u-abc-123'),
          });
        })
        .executeTest(
          v4SynchronousBodyHandler((body: unknown) => {
            handleUserDeleted(body as UserDeletedEvent);
          }),
        );
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Request/Reply — Synchronous/Messages
  //    The consumer sends a request to "user-get-requests" and receives a
  //    correlated reply from "user-get-responses", modelled as an AsyncAPI
  //    "send" operation with a "reply" block (AsyncAPI 3.x request/reply).
  // ---------------------------------------------------------------------------

  describe('Request/Reply: getUser operation', () => {
    it('sends a getUserRequest and processes the getUserResponse', () => {
      return pact
        .addSynchronousInteraction('get user by ID')
        // Link to the AsyncAPI "getUser" operation (action: send, with reply)
        .reference('AsyncAPI', 'operationId', 'getUser')
        .withRequest((builder) => {
          builder.withJSONContent({
            userId: string('u-abc-123'),
          });
        })
        .withResponse((builder) => {
          builder.withJSONContent({
            userId: string('u-abc-123'),
            name: string('John Doe'),
            email: string('john.doe@example.com'),
          });
        })
        .executeTest(async (message) => {
          // Pact passes the synchronous message as { Request, Response[] }.
          // Response[0].content is a Buffer — parse it as JSON.
          const raw = message.Response[0].content as Buffer;
          const responseBody = JSON.parse(raw.toString()) as GetUserResponse;
          handleGetUserResponse(responseBody);
        });
    });
  });
});
