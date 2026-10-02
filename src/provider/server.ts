/**
 * User Service entry point.
 *
 * Starts the Kafka consumers for the operations in provider/asyncapi.yaml, plus a
 * small HTTP API that exists only to support testing:
 *
 *   GET    /health          200 once the Kafka consumers are ready
 *   GET    /users/:userId   current state of a user (used by the Drift probe)
 *   POST   /users           seed a user (used by Drift lifecycle hooks)
 *   DELETE /users           clear all users
 *
 * Environment:
 *   KAFKA_BROKERS  comma-separated broker list (default localhost:9092)
 *   PORT           HTTP port for the test-support API (default 8081)
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { startKafkaTransport } from './kafka.ts';
import { UserRepository, UserService, type User } from './userService.ts';

const brokers = (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(',');
const port = Number(process.env.PORT ?? 8081);

const repository = new UserRepository();
const service = new UserService(repository);

let ready = false;

function send(res: ServerResponse, status: number, body?: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(body === undefined ? undefined : JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString() || 'null');
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const userMatch = url.pathname.match(/^\/users\/([^/]+)$/);

  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      return send(res, ready ? 200 : 503, { ready });
    }
    if (req.method === 'GET' && userMatch) {
      const user = repository.get(decodeURIComponent(userMatch[1]));
      return user ? send(res, 200, user) : send(res, 404, { error: 'not found' });
    }
    if (req.method === 'POST' && url.pathname === '/users') {
      const user = (await readJson(req)) as User;
      repository.save(user);
      return send(res, 201, user);
    }
    if (req.method === 'DELETE' && url.pathname === '/users') {
      repository.clear();
      return send(res, 200, { cleared: true });
    }
    send(res, 404, { error: 'not found' });
  } catch (err) {
    send(res, 400, { error: String(err) });
  }
});

server.listen(port, () => console.log(`[provider] test-support API listening on http://localhost:${port}`));

const transport = await startKafkaTransport(service, brokers);
await transport.ready;
ready = true;
console.log(`[provider] consuming from Kafka at ${brokers.join(',')}`);

const shutdown = async () => {
  server.close();
  await transport.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
