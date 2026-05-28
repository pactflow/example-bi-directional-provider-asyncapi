import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Pact test generation can be slow on first run (Rust FFI initialisation)
    testTimeout: 30_000,
    // Run each test file in its own worker so pact files are written atomically
    pool: 'forks',
    reporters: ['verbose'],
  },
});
