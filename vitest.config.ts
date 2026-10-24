/**
 * Vitest config — added with R3.2d so the new pure modules in src/lib/
 * (eventClassify, eventDedup, liveEventInvalidation) can be unit-tested
 * without spinning up a backend.
 *
 * jsdom environment so QueryClient and DOM-touching utilities don't blow
 * up in headless mode. globals=true makes describe/it/expect available
 * without per-file imports for terser tests; we still import them
 * explicitly in the R3.2d suite for clarity.
 */
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./src/test/setup.ts'],
  },
});
