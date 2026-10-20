/**
 * Kafka transport for the User Service.
 *
 * Topic names come from the channel addresses in provider/asyncapi.yaml.
 */

import { readFileSync } from 'node:fs';
import avro from 'avsc';
import { Kafka, logLevel, type Consumer, type IHeaders, type Producer } from 'kafkajs';
import protobuf from 'protobufjs';
import type { GetUserRequest, UserCreated, UserEvent, UserService } from './userService.ts';

export const TOPICS = {
  userEvents: 'user-events',
  userEventsAvro: 'user-events-avro',
  userEventsProtobuf: 'user-events-protobuf',
  getUserRequests: 'user-get-requests',
  getUserResponses: 'user-get-responses',
} as const;

const CORRELATION_ID_HEADER = 'correlation-id';
const REPLY_TO_HEADER = 'reply-to';

function headerValue(headers: IHeaders | undefined, name: string): string | undefined {
  const value = headers?.[name];
  if (value === undefined) return undefined;
  return (Array.isArray(value) ? value[0] : value)?.toString();
}

// The provider's own copies of the schemas embedded in provider/asyncapi.yaml
const schemaUrl = (file: string) => new URL(`./schemas/${file}`, import.meta.url);

const userCreatedAvro = avro.Type.forSchema(
  JSON.parse(readFileSync(schemaUrl('user-created.avsc'), 'utf8')) as avro.Schema,
);

const userCreatedProtobuf = protobuf
  .loadSync(schemaUrl('user.proto').pathname)
  .lookupType('users.UserCreated');

function decodeUserCreatedAvro(bytes: Buffer): UserCreated {
  const record = userCreatedAvro.fromBuffer(bytes) as { userId: string; email: string; name: string | null };
  return { userId: record.userId, email: record.email, name: record.name ?? undefined };
}

function decodeUserCreatedProtobuf(bytes: Buffer): UserCreated {
  // protobufjs converts the snake_case field names (user_id) to camelCase (userId)
  return userCreatedProtobuf.toObject(userCreatedProtobuf.decode(bytes)) as UserCreated;
}

export interface KafkaTransport {
  /** Resolves once every consumer has joined its group and is receiving. */
  ready: Promise<void>;
  stop(): Promise<void>;
}

export async function startKafkaTransport(service: UserService, brokers: string[]): Promise<KafkaTransport> {
  const kafka = new Kafka({ clientId: 'user-service', brokers, logLevel: logLevel.WARN });

  // The provider owns its topics, so it makes sure they exist before consuming.
  const admin = kafka.admin();
  await admin.connect();
  await admin.createTopics({
    waitForLeaders: true,
    topics: Object.values(TOPICS).map((topic) => ({ topic, numPartitions: 1, replicationFactor: 1 })),
  });
  await admin.disconnect();

  const producer: Producer = kafka.producer();
  await producer.connect();

  const eventsConsumer = kafka.consumer({ groupId: 'user-service.user-events' });
  const avroEventsConsumer = kafka.consumer({ groupId: 'user-service.user-events-avro' });
  const protobufEventsConsumer = kafka.consumer({ groupId: 'user-service.user-events-protobuf' });
  const requestsConsumer = kafka.consumer({ groupId: 'user-service.user-get-requests' });

  const joined = (consumer: Consumer) =>
    new Promise<void>((resolve) => consumer.on(consumer.events.GROUP_JOIN, () => resolve()));
  const ready = Promise.all(
    [eventsConsumer, avroEventsConsumer, protobufEventsConsumer, requestsConsumer].map(joined),
  ).then(() => undefined);

  // receiveUserEvents — fire-and-forget
  await eventsConsumer.connect();
  await eventsConsumer.subscribe({ topic: TOPICS.userEvents });
  await eventsConsumer.run({
    eachMessage: async ({ message }) => {
      try {
        service.handleUserEvent(JSON.parse(message.value?.toString() ?? 'null') as UserEvent);
      } catch (err) {
        console.error('[provider] failed to process user event:', err);
      }
    },
  });

  // receiveUserEventsAvro / receiveUserEventsProtobuf — fire-and-forget, binary payloads
  const binaryEvents = [
    { consumer: avroEventsConsumer, topic: TOPICS.userEventsAvro, decode: decodeUserCreatedAvro },
    { consumer: protobufEventsConsumer, topic: TOPICS.userEventsProtobuf, decode: decodeUserCreatedProtobuf },
  ];
  for (const { consumer, topic, decode } of binaryEvents) {
    await consumer.connect();
    await consumer.subscribe({ topic });
    await consumer.run({
      eachMessage: async ({ message }) => {
        try {
          service.handleUserEvent(decode(message.value ?? Buffer.alloc(0)));
        } catch (err) {
          console.error(`[provider] failed to process ${topic} event:`, err);
        }
      },
    });
  }

  // getUser — request/reply. The correlation id is copied onto the reply so the
  // requester can match it, and an explicit reply-to header wins over the default topic.
  await requestsConsumer.connect();
  await requestsConsumer.subscribe({ topic: TOPICS.getUserRequests });
  await requestsConsumer.run({
    eachMessage: async ({ message }) => {
      try {
        const reply = service.handleGetUserRequest(JSON.parse(message.value?.toString() ?? 'null') as GetUserRequest);
        if (!reply) return;

        const correlationId = headerValue(message.headers, CORRELATION_ID_HEADER);
        await producer.send({
          topic: headerValue(message.headers, REPLY_TO_HEADER) ?? TOPICS.getUserResponses,
          messages: [
            {
              key: reply.userId,
              value: JSON.stringify(reply),
              headers: correlationId ? { [CORRELATION_ID_HEADER]: correlationId } : {},
            },
          ],
        });
      } catch (err) {
        console.error('[provider] failed to process getUser request:', err);
      }
    },
  });

  return {
    ready,
    async stop() {
      await Promise.allSettled([
        eventsConsumer.disconnect(),
        avroEventsConsumer.disconnect(),
        protobufEventsConsumer.disconnect(),
        requestsConsumer.disconnect(),
        producer.disconnect(),
      ]);
    },
  };
}
