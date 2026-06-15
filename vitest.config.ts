import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Resolve the `@/*` → `src/*` path alias (mirrors tsconfig.json) so tests can
// import modules that use the alias.
export default defineConfig({
  // Use React's automatic JSX runtime so component tests don't need React in scope
  // (matches the Next.js/SWC build behaviour).
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // Default to node for the existing logic tests. Component/DOM tests opt into jsdom
    // per-file with a `// @vitest-environment jsdom` docblock at the top of the file.
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
  },
});
