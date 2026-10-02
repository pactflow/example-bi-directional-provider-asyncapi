/**
 * Drift probe for the receiveUserEvents operation (async-inject mode).
 *
 * Drift publishes a message to `user-events` and then runs this probe to collect
 * evidence that the User Service processed it. Kafka is asynchronous, so the probe
 * polls the service's test-support API until the user reaches the expected state
 * (or the timeout passes), then prints the observed state as JSON on stdout for
 * Drift to compare against the test case's `expected` block.
 *
 * Usage:
 *   node drift/probes/user-state.ts --user-id <id> --until <present|absent> [--timeout-ms 3000]
 */

import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    'user-id': { type: 'string' },
    until: { type: 'string', default: 'present' },
    'timeout-ms': { type: 'string', default: '3000' },
    'base-url': { type: 'string', default: process.env.PROVIDER_BASE_URL ?? 'http://localhost:8081' },
  },
});

const userId = values['user-id'];
if (!userId) {
  console.error('--user-id is required');
  process.exit(2);
}

const wantPresent = values.until === 'present';
const deadline = Date.now() + Number(values['timeout-ms']);

async function observe(): Promise<Record<string, unknown>> {
  const res = await fetch(`${values['base-url']}/users/${encodeURIComponent(userId!)}`);
  if (res.status === 404) return { userId, exists: false };
  return { ...(await res.json()), exists: true };
}

let state = await observe();
while (state.exists !== wantPresent && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 100));
  state = await observe();
}

console.log(JSON.stringify(state));
