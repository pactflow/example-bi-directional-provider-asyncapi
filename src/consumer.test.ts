/**
 * Pact consumer tests for the User Service messaging contract.
 *
 * These tests generate a Pact file that describes the messages this consumer
 * expects to receive from the User Service provider. In bi-directional contract
 * testing the provider side is verified by comparing the Pact file against the
 * provider's AsyncAPI document — no provider code needs to run.
 *
 * Three kinds of interaction are demonstrated:
 *
 *   1. Fire-and-forget (Asynchronous/Messages)
 *      The provider publishes an event; the consumer handles it.
 *      AsyncAPI operation action: "receive"
 *
 *   2. Fire-and-forget with binary payloads (Asynchronous/Messages)
 *      The same event encoded with Avro or Protobuf, written by the Pact Avro
 *      and Protobuf plugins.
 *
 *   3. Request/Reply (Synchronous/Messages)
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
  decodeUserCreatedAvro,
  decodeUserCreatedProtobuf,
  type UserCreatedEvent,
  type UserDeletedEvent,
  type GetUserResponse,
} from './consumer.js';

const { string } = Matchers;

// The consumer's own copies of the Avro and Protobuf schemas
const schemaDir = path.resolve(import.meta.dirname, 'schemas');

// Pact passes plugin-generated message contents to the test as a base64 string
// rather than a Buffer, so turn them back into the bytes Kafka would deliver.
const bytesOf = (content: unknown): Buffer =>
  Buffer.isBuffer(content) ? content : Buffer.from(content as string, 'base64');

describe('User Service Consumer', () => {
  // Pact (aliased from PactV4) — no mock HTTP server; messages are exchanged
  // in-process through the Pact Rust core FFI.
  const pact = new Pact({
    consumer: 'pactflow-example-bi-directional-provider-asyncapi-consumer',
    provider: 'pactflow-example-bi-directional-provider-asyncapi',
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
  // 2. Binary payloads — Avro and Protobuf (Asynchronous/Messages)
  //    The same userCreated event, on channels that carry Avro and Protobuf
  //    instead of JSON.  The Pact Avro and Protobuf plugins encode a real binary
  //    message from the consumer's schema (src/schemas/) and embed that schema
  //    in the pact, so PactFlow can compare it with the provider's schema.
  //
  //    Every key that doesn't start with "pact:" describes a field, using a
  //    matching rule definition expression such as notEmpty('...').
  // ---------------------------------------------------------------------------

  describe('Avro: receiveUserEventsAvro operation', () => {
    it('handles an Avro userCreated event', () => {
      return pact
        .addAsynchronousInteraction()
        .reference('AsyncAPI', 'operationId', 'receiveUserEventsAvro')
        .usingPlugin({ plugin: 'avro', version: '0.1.3' })
        .expectsToReceive('a user-created event (Avro)')
        .withPluginContents(
          JSON.stringify({
            'pact:avro': path.resolve(schemaDir, 'user-created.avsc'),
            'pact:record-name': 'UserCreated',
            'pact:content-type': 'avro/binary',
            userId: "notEmpty('u-abc-123')",
            email: "notEmpty('user@example.com')",
          }),
          'avro/binary',
        )
        // The handler receives the encoded bytes, exactly as they arrive from Kafka
        .executeTest(async (message) => {
          handleUserCreated(decodeUserCreatedAvro(bytesOf(message.contents.content)));
        });
    });
  });

  describe('Protobuf: receiveUserEventsProtobuf operation', () => {
    it('handles a Protobuf userCreated event', () => {
      return pact
        .addAsynchronousInteraction()
        .reference('AsyncAPI', 'operationId', 'receiveUserEventsProtobuf')
        .usingPlugin({ plugin: 'protobuf', version: '0.8.1' })
        .expectsToReceive('a user-created event (Protobuf)')
        .withPluginContents(
          JSON.stringify({
            'pact:proto': path.resolve(schemaDir, 'user.proto'),
            'pact:message-type': 'UserCreated',
            'pact:content-type': 'application/protobuf',
            // Protobuf field names, as written in the .proto file
            user_id: "notEmpty('u-abc-123')",
            email: "notEmpty('user@example.com')",
          }),
          'application/protobuf',
        )
        .executeTest(async (message) => {
          handleUserCreated(decodeUserCreatedProtobuf(bytesOf(message.contents.content)));
        });
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Request/Reply — Synchronous/Messages
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
