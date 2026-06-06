import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Resolve the `@/*` → `src/*` path alias (mirrors tsconfig.json) so tests can
// import modules that use the alias.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
  },
});
