/**
 * User Service consumer handlers.
 *
 * These are the functions that process messages received from the User Service.
 * They represent the consumer side of the contract — the provider must produce
 * messages that these handlers can successfully process.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import avro from 'avsc';
import protobuf from 'protobufjs';

/** A user-created event published when a new user registers. */
export interface UserCreatedEvent {
  userId: string;
  email: string;
  name?: string;
}

/** A user-deleted event published when a user account is removed. */
export interface UserDeletedEvent {
  userId: string;
}

/** A request to look up a user by ID (for request/reply exchanges). */
export interface GetUserRequest {
  userId: string;
}

/** The response to a user lookup request. */
export interface GetUserResponse {
  userId: string;
  name: string;
  email: string;
}

/** Handles an incoming userCreated event from the user-events channel. */
export function handleUserCreated(event: UserCreatedEvent): void {
  if (!event.userId) throw new Error('userId is required');
  if (!event.email) throw new Error('email is required');
  console.log(`[consumer] user created: ${event.userId} <${event.email}>`);
}

/** Handles an incoming userDeleted event from the user-events channel. */
export function handleUserDeleted(event: UserDeletedEvent): void {
  if (!event.userId) throw new Error('userId is required');
  console.log(`[consumer] user deleted: ${event.userId}`);
}

// ---------------------------------------------------------------------------
// Binary payloads
//
// The Avro and Protobuf channels carry the same userCreated event, encoded
// with the consumer's own copy of the schema (src/schemas/). The decoders turn
// the bytes back into a UserCreatedEvent, so the same handler processes it.
// ---------------------------------------------------------------------------

const schemaDir = fileURLToPath(new URL('./schemas/', import.meta.url));

const userCreatedAvro = avro.Type.forSchema(
  JSON.parse(readFileSync(path.join(schemaDir, 'user-created.avsc'), 'utf8')) as avro.Schema,
);

const userCreatedProtobuf = protobuf.loadSync(path.join(schemaDir, 'user.proto')).lookupType('users.UserCreated');

/** Decodes an Avro-encoded userCreated event from the user-events-avro channel. */
export function decodeUserCreatedAvro(bytes: Buffer): UserCreatedEvent {
  const record = userCreatedAvro.fromBuffer(bytes) as { userId: string; email: string; name: string | null };
  return { userId: record.userId, email: record.email, name: record.name ?? undefined };
}

/** Decodes a Protobuf-encoded userCreated event from the user-events-protobuf channel. */
export function decodeUserCreatedProtobuf(bytes: Buffer): UserCreatedEvent {
  // protobufjs converts the snake_case field names (user_id) to camelCase (userId)
  return userCreatedProtobuf.toObject(userCreatedProtobuf.decode(bytes)) as UserCreatedEvent;
}

/** Processes the response to a getUser request/reply exchange. */
export function handleGetUserResponse(response: GetUserResponse): GetUserResponse {
  if (!response.userId) throw new Error('userId is required');
  if (!response.name) throw new Error('name is required');
  if (!response.email) throw new Error('email is required');
  console.log(`[consumer] got user: ${response.userId} — ${response.name} <${response.email}>`);
  return response;
}
