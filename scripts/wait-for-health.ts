/**
 * Waits until a URL returns 2xx, e.g. the provider's /health endpoint.
 *
 * Usage: node scripts/wait-for-health.ts [url] [timeoutMs]
 */

const url = process.argv[2] ?? 'http://localhost:8081/health';
const timeoutMs = Number(process.argv[3] ?? 60_000);
const deadline = Date.now() + timeoutMs;

while (Date.now() < deadline) {
  try {
    const res = await fetch(url);
    if (res.ok) {
      console.log(`${url} is ready`);
      process.exit(0);
    }
  } catch {
    // not listening yet
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}

console.error(`Timed out after ${timeoutMs}ms waiting for ${url}`);
process.exit(1);
