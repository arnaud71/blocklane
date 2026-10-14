import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/frontend/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['shared/**/*.ts', 'server/**/*.ts', 'src/lib/**/*.ts'],
      exclude: ['server/index.ts'],
      reporter: ['text', 'html'],
    },
  },
});
