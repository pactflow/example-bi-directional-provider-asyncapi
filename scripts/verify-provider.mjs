/**
 * Provider verification script.
 *
 * Runs @pactflow/openapi-pact-comparator against every Pact file in ./pacts/
 * and the AsyncAPI document in ./provider/asyncapi.yaml.
 *
 * Exit code 0 = all interactions are compatible with the AsyncAPI spec.
 * Exit code 1 = one or more incompatibilities were found (errors are logged).
 *
 * Usage:
 *   npm run verify:provider
 *   node scripts/verify-provider.mjs
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { globSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Resolve project root relative to this script
// ---------------------------------------------------------------------------
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Load the AsyncAPI document (YAML → plain object)
// ---------------------------------------------------------------------------
const require = createRequire(import.meta.url);
const yaml = require('js-yaml');

const asyncapiPath = join(root, 'provider', 'asyncapi.yaml');
const asyncapi = yaml.load(readFileSync(asyncapiPath, 'utf8'));
console.log(`\n📄 AsyncAPI document: ${asyncapiPath}`);

// ---------------------------------------------------------------------------
// Discover generated Pact files
// ---------------------------------------------------------------------------
const pactDir = join(root, 'pacts');
let pactFiles;
try {
  pactFiles = globSync('*.json', { cwd: pactDir });
} catch {
  // node:fs globSync available from Node 22; fall back to a manual approach
  const { readdirSync } = await import('node:fs');
  pactFiles = readdirSync(pactDir).filter((f) => f.endsWith('.json'));
}

if (pactFiles.length === 0) {
  console.error(
    '\n❌ No pact files found in ./pacts/ — run "npm run test:consumer" first.\n',
  );
  process.exit(1);
}

console.log(`📦 Found ${pactFiles.length} pact file(s):\n`);
pactFiles.forEach((f) => console.log(`   • ${f}`));
console.log();

// ---------------------------------------------------------------------------
// Run comparator
// ---------------------------------------------------------------------------
let Comparator;
try {
  ({ Comparator } = await import('@pactflow/openapi-pact-comparator'));
} catch (e) {
  console.error('Failed to import @pactflow/openapi-pact-comparator:', e.message);
  process.exit(1);
}

let overallSuccess = true;

for (const pactFile of pactFiles) {
  const pactPath = join(pactDir, pactFile);
  const pact = JSON.parse(readFileSync(pactPath, 'utf8'));

  let comparator;
  try {
    comparator = new Comparator({
      asyncapi,
    });
  } catch (e) {
    if (e.message?.includes('Malformed OpenAPI') || e.constructor?.name === 'ParserError') {
      console.error(
        '\n❌ The installed @pactflow/openapi-pact-comparator does not support AsyncAPI.\n' +
        '   AsyncAPI BDCT is an early-access feature. Install the pre-release version:\n\n' +
        '     npm install "github:pactflow/openapi-pact-comparator"\n',
      );
    } else {
      console.error(`❌ Failed to create Comparator: ${e.message}`);
    }
    process.exit(1);
  }

  console.log(`🔍 Verifying: ${pactFile}`);

  const errors = [];
  const warnings = [];
  const info = [];

  for await (const result of comparator.compare(pact)) {
    if (result.type === 'error') {
      errors.push(result);
    } else if (result.type === 'warning') {
      warnings.push(result);
    } else {
      info.push(result);
    }
  }

  if (info.length > 0) {
    info.forEach((i) => console.info(`   🧪  ${i.message} (${i.code ?? 'unknown'})`));
  }

  if (warnings.length > 0) {
    warnings.forEach((w) => console.warn(`   ⚠  ${w.message} (${w.code ?? 'unknown'})`));
  }

  if (errors.length > 0) {
    overallSuccess = false;
    errors.forEach((e) => console.error(`   ✗  ${e.message} (${e.code ?? 'unknown'})`));
    console.log(`   ❌ ${pactFile} is NOT compatible\n`);
  } else {
    console.log();
    console.log(`   ✅ ${pactFile} is compatible with the AsyncAPI document\n`);
  }
}

if (!overallSuccess) {
  console.error('Provider verification FAILED — see errors above.\n');
  process.exit(1);
}

console.log('Provider verification PASSED ✅\n');
