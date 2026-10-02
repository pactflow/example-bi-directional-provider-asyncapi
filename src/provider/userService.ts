/**
 * User Service provider business logic.
 *
 * This is the provider side of the contract described in provider/asyncapi.yaml.
 * It is deliberately transport-agnostic: Kafka wiring lives in kafka.ts, so the
 * handlers here only deal with plain message payloads.
 *
 *   receiveUserEvents (action: receive) → handleUserEvent()
 *   getUser           (action: send + reply) → handleGetUserRequest()
 */

export interface User {
  userId: string;
  email: string;
  name?: string;
}

/** userCreated message on the `user-events` channel. */
export interface UserCreated {
  userId: string;
  email: string;
  name?: string;
}

/** userDeleted message on the `user-events` channel. */
export interface UserDeleted {
  userId: string;
}

export type UserEvent = UserCreated | UserDeleted;

/** getUserRequest message on the `user-get-requests` channel. */
export interface GetUserRequest {
  userId: string;
}

/** getUserResponse message on the `user-get-responses` channel. */
export interface GetUserResponse {
  userId: string;
  name: string;
  email: string;
}

/** Simple in-memory user store. */
export class UserRepository {
  private readonly users = new Map<string, User>();

  get(userId: string): User | undefined {
    return this.users.get(userId);
  }

  save(user: User): void {
    this.users.set(user.userId, user);
  }

  delete(userId: string): void {
    this.users.delete(userId);
  }

  clear(): void {
    this.users.clear();
  }
}

/**
 * Both userCreated and userDeleted arrive on the same channel. The AsyncAPI
 * document distinguishes them only by payload shape, so we do the same: a
 * userCreated event always carries an email address.
 */
function isUserCreated(event: UserEvent): event is UserCreated {
  return 'email' in event && typeof event.email === 'string';
}

export class UserService {
  private readonly repository: UserRepository;

  constructor(repository: UserRepository) {
    this.repository = repository;
  }

  /** Handles a message from the `user-events` channel. */
  handleUserEvent(event: UserEvent): void {
    if (!event?.userId) throw new Error('userId is required');

    if (isUserCreated(event)) {
      this.repository.save({ userId: event.userId, email: event.email, name: event.name });
      console.log(`[provider] user created: ${event.userId} <${event.email}>`);
    } else {
      this.repository.delete(event.userId);
      console.log(`[provider] user deleted: ${event.userId}`);
    }
  }

  /**
   * Handles a message from the `user-get-requests` channel and returns the
   * reply to publish on `user-get-responses`, or undefined if the user is unknown.
   */
  handleGetUserRequest(request: GetUserRequest): GetUserResponse | undefined {
    if (!request?.userId) throw new Error('userId is required');

    const user = this.repository.get(request.userId);
    if (!user) {
      console.log(`[provider] getUser: ${request.userId} not found`);
      return undefined;
    }

    console.log(`[provider] getUser: ${user.userId}`);
    return { userId: user.userId, name: user.name ?? '', email: user.email };
  }
}
