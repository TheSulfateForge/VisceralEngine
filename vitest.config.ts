import { defineConfig } from 'vitest/config';

// Review item 7: unit + token-budget tests. Node environment is enough — the
// suites under tests/ exercise pure prompt/schema logic with no DOM.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
